import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { CacheService } from '../shared/CacheService';
import { PageScraper } from '../shared/PageScraper';
import type { Page } from '../shared/PageScraper';
import * as path from 'path';

interface Question {
    index: string;
    question: string;
}

async function main() {
    const requestService = new RequestService();
    const headquarters = new HeadquartersService(requestService);
    const cacheService = new CacheService(path.join(__dirname, 'cache'));
    
    // Ensure cache directory exists
    await cacheService.ensureCacheDirectory();
    
    const pageScraper = new PageScraper(requestService, cacheService);
    
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

        // Scrape the page
        const url = 'https://softo.ag3nts.org';
        const page = await pageScraper.scrapePage(url);
        console.log('Page:', page);
    } catch (error) {
        console.error('Failed to process:', error);
    }
}

await main();