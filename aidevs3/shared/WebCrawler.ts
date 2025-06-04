import { OpenAIService } from './OpenAIService';
import { PageScraper } from './PageScraper';
import type { Page, Link } from './PageScraper';
import { RequestService } from './RequestService';
import { CacheService } from './CacheService';
import { ExpenseCounter } from './ExpenseCounter';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ChatCompletion } from 'openai/resources/chat/completions';

interface Question {
    index: string;
    question: string;
}

export interface CrawlerResult {
    question: Question;
    answer: string;
}

export class WebCrawler {
    private readonly pageScraper: PageScraper;
    private readonly openAIService: OpenAIService;
    private readonly baseUrl: string;
    private readonly maxDepth: number;
    private readonly expenseCounter: ExpenseCounter;
    private visitedUrls: Set<string> = new Set();

    constructor(
        requestService: RequestService,
        cacheService: CacheService,
        openAIService: OpenAIService,
        expenseCounter: ExpenseCounter,
        baseUrl: string = 'https://softo.ag3nts.org',
        maxDepth: number = 3
    ) {
        this.pageScraper = new PageScraper(requestService, cacheService);
        this.openAIService = openAIService;
        this.baseUrl = baseUrl;
        this.maxDepth = maxDepth;
        this.expenseCounter = expenseCounter;
    }

    private async checkForAnswer(page: Page, question: Question): Promise<string | null> {
        console.log('Checking for answer on page: ', page.url);
        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: 'You are an answer extractor. Your ONLY job is to return EXACTLY the answer found in the content, or "NO_ANSWER". Do not explain, do not add any text. Just return the answer. Be very precise in deciding if the answer is found in the content.'
            },
            {
                role: 'user',
                content: `Question: ${question.question}\n\nContent:\n${page.markdown}\n\nReturn EXACTLY the answer found in the content, or "NO_ANSWER".`
            }
        ];

        const response = await this.openAIService.completion({ messages }) as ChatCompletion;
        this.expenseCounter.increaseCost(response);
        const answer = response.choices[0]?.message?.content?.trim() ?? null;
        
        if (!answer || answer === "NO_ANSWER") {
            console.log('No answer found on page: ', page.url);
            return null;
        }

        return answer;
    }

    private async selectNextLink(page: Page, question: Question): Promise<string | null> {
        if (page.links.length === 0) {
            console.log('No links available on page:', page.url);
            return null;
        }

        // Filter out links we've already visited
        const unvisitedLinks = page.links.filter(link => {
            const fullUrl = new URL(link.href, this.baseUrl).toString();
            return !this.visitedUrls.has(fullUrl);
        });

        if (unvisitedLinks.length === 0) {
            console.log('All links have been visited');
            return null;
        }

        console.log(`Available ${unvisitedLinks.length} unvisited links on page: ${page.url}`);

        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: `You are a link selector. Your job is to evaluate the relevance of each link that might contain information related to the question.

Analyze the link information to understand what each link might contain. Consider:
- The meaning of the link text
- The title attribute which often provides additional context
- The relationship between the question and potential content

For each link create relevance rank between 0 and 1 (0 means not relevant at all, 1 means perfect match).

Return a JSON array of objects, each containing:
- relevanceRate: number between 0 and 1
- url: the URL of the link

Example response: [{"relevanceRate": 0.8, "url": "https://example.com/page1"}, {"relevanceRate": 0.3, "url": "https://example.com/page2"}]`
            },
            {
                role: 'user',
                content: `Question: ${question.question}

Available links:
${JSON.stringify(unvisitedLinks.map(link => ({
    url: link.href,
    text: link.text,
    title: link.title || ''
})), null, 2)}

Return a JSON array of objects with relevanceRate and url for each link.`
            }
        ];

        const response = await this.openAIService.completion({ messages }) as ChatCompletion;
        this.expenseCounter.increaseCost(response);
        const selectedLink = response.choices[0]?.message?.content?.trim() ?? null;
        
        if (!selectedLink) {
            console.log('No link selected for question:', question.question);
            return null;
        }

        try {
            const results = JSON.parse(selectedLink);

            
            if (!Array.isArray(results) || results.length === 0) {
                console.log('Invalid response format or no links evaluated');
                return null;
            }

            // Sort by relevance rate and get the highest rated link
            const bestResult = results.sort((a, b) => b.relevanceRate - a.relevanceRate)[0];
            
            if (bestResult.relevanceRate === 0) {
                console.log('No relevant links found for question:', question.question);
                return null;
            }

            // Find the exact match from available links
            const exactMatch = unvisitedLinks.find(link => link.href === bestResult.url);
            if (exactMatch) {
                console.log('Selected link:', exactMatch.href, 'with relevance rate:', bestResult.relevanceRate);
                return exactMatch.href;
            }

            console.warn('Invalid link selection:', bestResult.url);
            return null;
        } catch (error) {
            console.warn('Invalid JSON response:', selectedLink);
            return null;
        }
    }

    async crawlPage(url: string, question: Question): Promise<CrawlerResult | null> {
        // Check if we've reached max depth or already visited this URL
        if (this.visitedUrls.size >= this.maxDepth || this.visitedUrls.has(url)) {
            return null;
        }

        // Add current URL to visited list
        this.visitedUrls.add(url);

        // Scrape the page
        const page = await this.pageScraper.scrapePage(url);
        if (page.links.length > 50) {
            console.log('Too many links on page:', url);
            return null;
        }

        // Check if we can answer the question with current page
        const answer = await this.checkForAnswer(page, question);
        if (answer) {
            return {
                question,
                answer
            };
        }

        // If we can't answer, select next link to visit
        const nextLink = await this.selectNextLink(page, question);
        if (!nextLink) {
            return null;
        }

        // Construct full URL for the next link
        const nextUrl = new URL(nextLink, this.baseUrl).toString();

        // Recursively crawl the next page
        return this.crawlPage(nextUrl, question);
    }

    async startCrawling(question: Question): Promise<CrawlerResult | null> {
        // Reset visited URLs for each new crawl
        this.visitedUrls.clear();
        return this.crawlPage(this.baseUrl, question);
    }
} 