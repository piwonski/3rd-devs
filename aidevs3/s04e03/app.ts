import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { CacheService } from '../shared/CacheService';
import { OpenAIService } from '../shared/OpenAIService';
import { WebCrawler, type CrawlerResult } from '../shared/WebCrawler';
import * as path from 'path';

interface Question {
    index: string;
    question: string;
}

async function processQuestions(webCrawler: WebCrawler, questions: Question[]): Promise<CrawlerResult[]> {
    const results: CrawlerResult[] = [];

    for (const question of questions) {
        console.log(`Processing question: ${question.question}`);
        
        const result = await webCrawler.startCrawling(question);
        if (result) {
            results.push(result);
            console.log(`Found answer for question ${question.index}: ${result.answer}`);
            console.log(`Visited URLs: ${result.visitedUrls.join(' -> ')}`);
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
    
    // Ensure cache directory exists
    await cacheService.ensureCacheDirectory();
    
    const webCrawler = new WebCrawler(requestService, cacheService, openAIService);
    
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
        
        // Send answers back to headquarters
        for (const result of results) {
            await headquarters.report(result.question.index, result.answer);
        }
    } catch (error) {
        console.error('Failed to process:', error);
    }
}

await main();