import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { OpenAIService } from '../shared/OpenAIService';
import { RequestService } from '../shared/RequestService';
import { HeadquartersService } from '../shared/HeadquartersService';
import { ExpenseCounter } from '../shared/ExpenseCounter';

const requestService = new RequestService();
const openAIService = new OpenAIService();
const headquartersService = new HeadquartersService(requestService);
const expenseCounter = new ExpenseCounter();

const prompt = `
You are an assistant specialized in preparing keywords for reports
You will be given a file with facts about a company.
Based on the facts, you will prepare a list of keywords for the given report.
The keywords should be in the following format:
keyword1, keyword2, keyword3, ...

<facts>
{{facts}}
</facts>

<report>
{{report_name}}
{{report_content}}
</report>
`

interface OpenAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

interface OpenAIRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
}

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

async function getKeywordsFromCache(): Promise<string | null> {
    const cacheFile = join(__dirname, 'cache', 'keywords.json');
    try {
        const keywords = await readFile(cacheFile, 'utf-8');
        console.log('Keywords found in cache');
        return keywords;
    } catch {
        return null;
    }
}

async function saveKeywordsToCache(keywords: string): Promise<void> {
    const cacheDir = join(__dirname, 'cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'keywords.json'), keywords, 'utf-8');
}

async function generateKeywordsForReports(facts: string[], reports: Array<{ filename: string; content: string }>): Promise<string> {
    const reportKeywords = [];
    for (const report of reports) {
        reportKeywords.push({
            [report.filename]: await generateKeywords(facts, report)
        });
    }
    return JSON.stringify(Object.assign({}, ...reportKeywords));
}

async function generateKeywords(facts: string[], report: { filename: string; content: string }): Promise<string> {
    console.log(`Generating keywords for ${report.filename}...`);
    const factsText = facts.join('\n');
    const filledPrompt = prompt
        .replace('{{facts}}', factsText)
        .replace('{{report_name}}', report.filename)
        .replace('{{report_content}}', report.content);

    const response = await openAIService.completion({
        messages: [{ role: 'user', content: filledPrompt }],
        model: 'gpt-4o',
        stream: false
    });

    if ('choices' in response && response.choices[0]?.message?.content) {
        return response.choices[0].message.content;
    }
    throw new Error('Unexpected response format from OpenAI');
}

async function main() {
    const facts = await readFacts();
    console.log('Number of facts:', facts.length);

    const reports = await readReports();
    console.log('Number of reports:', reports.length);
    
    let keywordsMap = await getKeywordsFromCache();
    if (!keywordsMap) {
        console.log('Generating keywords for reports...');
        keywordsMap = await generateKeywordsForReports(facts, reports);
        await saveKeywordsToCache(keywordsMap);
    }

    console.log('Keywords map:', keywordsMap);
    const headquartersResponse = await headquartersService.report('dokumenty', JSON.parse(keywordsMap));
    console.log('Headquarters response:', headquartersResponse);
}

await main();