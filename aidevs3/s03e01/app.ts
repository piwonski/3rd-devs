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

const prompt = `
You need to analyze given facts, extract key information and use this information to prepare a list of keywords for the given report.
Identify key information from the report: what happened, where and who was involved, which items and technologies were described.
Find facts related to the analysed report. The most often link will be people mentioned in the report and in the facts.
Use also the report name while preparing the list of keywords. Not necesarily as a one of the keywords, but as a context for the keywords.
Keywords MUST BE in Polish language.
Keywords MUST BE in nominative case (e.g 'nauczyciel', 'programista, NOT 'nauczyciela', 'programistów')
Keyword list should precisely describe the report, taking into account report content, related facts and information from the filename.
If the report is about a person, find related facts about this person, their occupation, skills, etc and use them to generate keywords.

<Examples>
If the report mentions about 'Adam Kowalski' and there is a fact about 'Adam Kowalski' being a teacher, one of the keywords should be 'nauczyciel'.
If the report mentions about 'Barbara Nowak' and there is a fact about 'Barbara Nowak' being a programmer, one of the keywords should be 'programista'.
</Examples>

There is no limitation on the number of keywords.
The list of keywords should be in the following format:
keyword1, keyword2, keyword3, ...
`

async function readFacts(): Promise<string[]> {
    const factsDir = join(__dirname, 'input-files', 'facts');
    const files = await readdir(factsDir);
    const facts = await Promise.all(
        files.map(async (file) => readFile(join(factsDir, file), 'utf-8'))
    );
    return facts;
}

async function readReports(): Promise<Array<{ filename: string; content: string }>> {
    const reportsDir = join(__dirname, 'input-files', 'reports');
    const files = await readdir(reportsDir);
    const reports = await Promise.all(
        files.map(async (file) => ({
            filename: file,
            content: await readFile(join(reportsDir, file), 'utf-8')
        }))
    );
    return reports;
}

async function getKeywordsFromCache(filename: string): Promise<string | null> {
    const cacheFile = join(__dirname, 'cache', filename);
    try {
        return await readFile(cacheFile, 'utf-8');
    } catch {
        return null;
    }
}

async function saveKeywordsToCache(keywords: string, filename: string): Promise<void> {
    const cacheDir = join(__dirname, 'cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, filename), keywords, 'utf-8');
}

async function generateKeywordsForReports(facts: string[], reports: Array<{ filename: string; content: string }>): Promise<string> {
    const trace = langfuseService.createTrace({id: uuidv4(), name: 'S03E01', sessionId: uuidv4()});

    const reportKeywords: Array<{ [key: string]: string }> = [];

    for (const report of reports) {
        const keywordsFromCache = await getKeywordsFromCache(report.filename);
        if (keywordsFromCache) {
            reportKeywords.push({
                [report.filename]: keywordsFromCache
            });
        } else {
            const keywords = await generateKeywords(trace, facts, report);
            console.log(`\n${keywords}\n`);
            reportKeywords.push({
                [report.filename]: keywords
            });
            await saveKeywordsToCache(keywords, report.filename);
        }
    }

    await langfuseService.flushAsync();
    return JSON.stringify(Object.assign({}, ...reportKeywords));
}

async function generateKeywords(trace: LangfuseTraceClient, facts: string[], report: { filename: string; content: string; }): Promise<string> {
    console.log(`Generating keywords for ${report.filename}...`);

    const generation = langfuseService.createGeneration(trace, 'generate-keywords', {
        prompt,
        report_name: report.filename,
        report_content: report.content
    });

    const factsText = facts.join('\n\n');
    const factsPrompt = `
        <facts>
        ${factsText}
        </facts>
    `

    const reportPrompt = `
        <report>
        ${report.filename}
        ${report.content}
        </report>
    `

    try {
        const response = await openAIService.completion({
            messages: [
                { role: 'system', content: prompt },
                { role: 'system', content: factsPrompt }, 
                { role: 'user', content: reportPrompt }
            ],
            model: 'gpt-4o',
            stream: false
        }) as OpenAI.Chat.Completions.ChatCompletion;
        
        expenseCounter.increaseCost(response);

        if ('choices' in response && response.choices[0]?.message?.content) {
            langfuseService.finalizeGeneration(generation, response.choices[0].message, response.model, {
                promptTokens: response.usage?.prompt_tokens,
                completionTokens: response.usage?.completion_tokens,
                totalTokens: response.usage?.total_tokens
            });
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

    console.log('Generating keywords for reports...');
    const keywordsMap = await generateKeywordsForReports(facts, reports);
    await saveKeywordsToCache(keywordsMap, 'keywords.json');

    const headquartersResponse = await headquartersService.report('dokumenty', JSON.parse(keywordsMap));
    console.log('Headquarters response:', headquartersResponse);

    console.log("Used tokens: " + JSON.stringify(expenseCounter.getUsedTokens()));
}

await main();