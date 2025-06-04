import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { CacheService } from '../shared/CacheService';
import { OpenAIService } from '../shared/OpenAIService';
import { WebCrawler, type CrawlerResult, type SupervisionContext } from '../shared/WebCrawler';
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

async function supervisionCallback(context: SupervisionContext): Promise<boolean> {
    console.log('\nCurrent URL:', context.currentUrl);
    console.log('Visited URLs:', Array.from(context.visitedUrls.values()).join(' -> '));

    if (context.nextLink) {
        console.log('\nSelected next link:', context.nextLink);
        const answer = await question('Do you want to follow this link? (y/n): ');
        return answer.toLowerCase() === 'y';
    }

    if (context.answer) {
        console.log('\nFound answer:', context.answer);
        const answer = await question('Do you want to accept this answer? (y/n): ');
        return answer.toLowerCase() === 'y';
    }

    return false;
}

async function processQuestions(webCrawler: WebCrawler, questions: Question[]): Promise<CrawlerResult[]> {
    const results: CrawlerResult[] = [];

    const filteredQuestions = questions.filter(question => question.index === '02');

    for (const question of filteredQuestions) {
        console.log(`Processing question: ${question.question}`);
        
        const result = await webCrawler.startCrawling(question);
        if (result) {
            results.push(result);
            console.log(`Found answer for question ${question.index}: ${result.answer}`);
            console.log(`Visited URLs: ${Array.from(result.visitedUrls.values()).join(' -> ')}`);
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
    await cacheService.clearCache();
    
    const webCrawler = new WebCrawler(requestService, cacheService, openAIService, undefined, undefined, supervisionCallback);
    
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
    } finally {
        rl.close();
    }
}

await main();