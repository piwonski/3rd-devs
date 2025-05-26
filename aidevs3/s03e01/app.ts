import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { OpenAIService } from '../shared/OpenAIService';
import { RequestService } from '../shared/RequestService';
import { HeadquartersService } from '../shared/HeadquartersService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import { LangfuseService } from '../shared/LangfuseService';
import { LangfuseTraceClient } from 'langfuse';
import { v4 as uuidv4 } from 'uuid';
import type OpenAI from 'openai';

const requestService = new RequestService();
const openAIService = new OpenAIService();
const headquartersService = new HeadquartersService(requestService);
const expenseCounter = new ExpenseCounter();
const langfuseService = new LangfuseService();

const factsKeywordsPrompt = `
Read the following facts and extract key information. 
If the fact is about a person, provide also information about the person's identity, occupation, skills, names of technologies the person is familiar with, etc.
Use strict sentence structure. 
DON'T use bullet points, paragraphs, etc.
`

const reportKeywordsPrompt = `
You are the report analyst. Imagine you are a detective, trying to find the most important information in the report.
You need to analyze given facts, extract key information and use this information to prepare a list of keywords for the given report.
Identify key information from the report: what happened, where and who was involved, which items and technologies were described.
Find facts related to the analysed report. The most often link will be people mentioned in the report and in the facts.
Use also the report name while preparing the list of keywords. Not necesarily as a one of the keywords, but as a context for the keywords.
Keywords MUST BE in Polish language.
Keywords MUST BE in nominative case (e.g 'nauczyciel', 'programista, NOT 'nauczyciela', 'programistów')
Keyword list should precisely describe the report, taking into account report content, related facts and information from the filename.
If the report is about a person, find related facts about this person, their occupation, skills, etc and use them to generate keywords.
Be precise in reading filename. If the filename is report-00-sektor-C4.txt, the keyword should be 'sektor C4' not 'sektor C'.

<Examples>
If the report mentions about 'Adam Kowalski' and there is a fact about 'Adam Kowalski' being a teacher, one of the keywords should be 'nauczyciel'.
If the report mentions about 'Barbara Nowak' and there is a fact about 'Barbara Nowak' being a programmer, one of the keywords should be 'programista'.
If the report mentions about 'Barbara Nowak' and there is a fact about 'Barbara Nowak' knows 'JavaScript', one of the keywords should be 'JavaScript'.
</Examples>

There is no limitation on the number of keywords.
The list of keywords should be in the following format:
keyword1, keyword2, keyword3, ...
`
async function readFacts(): Promise<Array<{ filename: string; content: string }>> {
    const factsDir = join(__dirname, 'input-files', 'facts');
    return await readFileContents(factsDir);
}

async function readReports(): Promise<Array<{ filename: string; content: string }>> {
    const reportsDir = join(__dirname, 'input-files', 'reports');
    return await readFileContents(reportsDir);
}

async function readFileContents(directory: string): Promise<Array<{ filename: string; content: string }>> {
    const files = await readdir(directory);
    const reports = await Promise.all(
        files.map(async (file) => ({
            filename: file,
            content: await readFile(join(directory, file), 'utf-8')
        }))
    );
    return reports;
}

async function getContentFromCache(filename: string): Promise<string | null> {
    const cacheFile = join(__dirname, 'cache', filename);
    try {
        return await readFile(cacheFile, 'utf-8');
    } catch {
        return null;
    }
}

async function saveContentToCache(content: string, filename: string): Promise<void> {
    const cacheDir = join(__dirname, 'cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, filename), content, 'utf-8');
}

async function generateFactSummary(trace: LangfuseTraceClient, fact: { filename: string; content: string }): Promise<string> {
    const generation = langfuseService.createGeneration(trace, 'generate-fact-summary', {
        prompt: factsKeywordsPrompt,
        fact: fact
    });

    try {
        // Workaround for rate limit
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10_000));

        const response = await openAIService.completion({
            messages: [
                { role: 'system', content: factsKeywordsPrompt },
                { role: 'user', content: fact.content }
            ],
            model: 'gpt-4.1',
            stream: false
        }) as OpenAI.Chat.Completions.ChatCompletion;
        
        expenseCounter.increaseCost(response);

        langfuseService.finalizeGeneration(generation, response, response.model, {
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
            totalTokens: response.usage?.total_tokens
        });

        if ('choices' in response && response.choices[0]?.message?.content) {
            return response.choices[0].message.content;
        } else {
            throw new Error('Unexpected response format from OpenAI');
        }
    } catch (error: any) {
        langfuseService.finalizeGeneration(generation, { error: error.message }, "unknown");
        throw error;
    }
}

async function generateFactsSummaries(facts: Array<{ filename: string; content: string }>): Promise<string[]> {
    const trace = langfuseService.createTrace({id: uuidv4(), name: 'S03E01/facts-summaries', sessionId: uuidv4()});
    const summaries: string[] = [];

    for (const fact of facts) {
        const factFromCache = await getContentFromCache(fact.filename);
        if (factFromCache) {
            summaries.push(factFromCache);
            continue;
        }
        
        const summary = await generateFactSummary(trace, fact);
        console.log(`Generated summary for ${fact.filename}: \n${summary}\n`);
        await saveContentToCache(summary, fact.filename);
        summaries.push(summary);
    }

    return summaries;
}

async function generateKeywordsForReports(facts: string[], reports: Array<{ filename: string; content: string }>): Promise<string> {
    const trace = langfuseService.createTrace({id: uuidv4(), name: 'S03E01/report-keywords', sessionId: uuidv4()});
    const reportKeywords: Array<{ [key: string]: string }> = [];

    for (const report of reports) {
        const keywordsFromCache = await getContentFromCache(report.filename);
        if (keywordsFromCache) {
            reportKeywords.push({
                [report.filename]: keywordsFromCache
            });
            continue;
        }

        const keywords = await generateReportKeywords(trace, facts, report);
        console.log(`Generated keywords for ${report.filename}: \n${keywords}\n`);
        await saveContentToCache(keywords, report.filename);
        reportKeywords.push({
            [report.filename]: keywords
        });
    }

    await langfuseService.flushAsync();
    return JSON.stringify(Object.assign({}, ...reportKeywords));
}

async function generateReportKeywords(trace: LangfuseTraceClient, facts: string[], report: { filename: string; content: string; }): Promise<string> {
    const generation = langfuseService.createGeneration(trace, 'generate-keywords', {
        prompt: reportKeywordsPrompt,
        report_name: report.filename,
        report_content: report.content
    });

    const factsText = facts.join('\n\n');
    const factsInput = `
        <facts>
        ${factsText}
        </facts>
    `

    const reportsInput = `
        <report>
        ${report.filename}
        ${report.content}
        </report>
    `

    try {
        // Workaround for rate limit
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10_000));

        const response = await openAIService.completion({
            messages: [
                { role: 'system', content: reportKeywordsPrompt },
                { role: 'system', content: factsInput }, 
                { role: 'user', content: reportsInput }
            ],
            model: 'gpt-4.1',
            stream: false
        }) as OpenAI.Chat.Completions.ChatCompletion;
        
        expenseCounter.increaseCost(response);
        langfuseService.finalizeGeneration(generation, response, response.model, {
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
            totalTokens: response.usage?.total_tokens
        });
        
        if ('choices' in response && response.choices[0]?.message?.content) {
            return response.choices[0].message.content;
        }
        throw new Error('Unexpected response format from OpenAI');
    } catch (error: any) {
        langfuseService.finalizeGeneration(generation, { error: error.message }, "unknown");
        throw error;
    }
}

async function main() {
    const facts = await readFacts();
    console.log('Number of facts:', facts.length);

    const reports = await readReports();
    console.log('Number of reports:', reports.length);

    console.log('Generating facts summary...');
    const factsSummary = await generateFactsSummaries(facts);
    await saveContentToCache(JSON.stringify(factsSummary), 'facts-summary.json');

    console.log('Generating keywords for reports...');
    const keywordsMap = await generateKeywordsForReports(factsSummary, reports);
    await saveContentToCache(keywordsMap, 'keywords.json');

    console.log('Sending report to headquarters...');
    const headquartersResponse = await headquartersService.report('dokumenty', JSON.parse(keywordsMap));
    console.log('Headquarters response:', headquartersResponse);

    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

await main();