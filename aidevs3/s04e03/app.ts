import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { CacheService } from '../shared/CacheService';
import { OpenAIService } from '../shared/OpenAIService';
import { WebCrawler, type CrawlerResult } from '../shared/WebCrawler';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import * as path from 'path';
import * as readline from 'readline';

interface Question {
    index: string;
    question: string;
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
};

async function processQuestions(webCrawler: WebCrawler, questions: Question[]): Promise<CrawlerResult[]> {
    const results: CrawlerResult[] = [];

    for (const question of questions) {
        console.log(`\nProcessing question: ${question.index} - ${question.question}`);
        
        const result = await webCrawler.startCrawling(question);
        if (result) {
            results.push(result);
            console.log(`Found answer for question ${question.index}: ${result.answer}`);
        } else {
            console.log(`No answer found for question ${question.index}`);
        }
    }

    return results;
}

async function main() {
    const requestService = new RequestService();
    const headquarters = new HeadquartersService(requestService);
    const cacheService = new CacheService(path.join(__dirname, 'cache'));
    const openAIService = new OpenAIService();
    const expenseCounter = new ExpenseCounter();
    
    // Ensure cache directory exists
    await cacheService.ensureCacheDirectory();
    await cacheService.clearCache();
    
    const webCrawler = new WebCrawler(requestService, cacheService, openAIService, expenseCounter);
    
    try {
        // Get questions
        const questionsJson = await headquarters.getSoftoQuestions();
        const questionsData = JSON.parse(questionsJson);
        const questionsList: Question[] = Object.entries(questionsData)
            .map(([index, question]) => ({
                index,
                question: question as string
            }));
        
        console.log('Questions:', questionsList);

        // Process questions using the web crawler
        const results = await processQuestions(webCrawler, questionsList);
        
        // Format answers into the required structure
        const formattedAnswers = results.reduce((acc, result) => {
            acc[result.question.index] = result.answer;
            return acc;
        }, {} as Record<string, string>);

        console.log('Formatted answers:', formattedAnswers);
        
        // Send all answers back to headquarters in one request
        const headquartersResponse = await headquarters.report('softo', formattedAnswers);
        console.log('Headquarters response:', headquartersResponse);
        
        // Log token usage
        console.log('Used tokens:', expenseCounter.getUsedTokens());
    } catch (error) {
        console.error('Failed to process:', error);
    } finally {
        rl.close();
    }
}

await main();