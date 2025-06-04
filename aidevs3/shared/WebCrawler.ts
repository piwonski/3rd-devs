import { OpenAIService } from './OpenAIService';
import { PageScraper } from './PageScraper';
import type { Page } from './PageScraper';
import { RequestService } from './RequestService';
import { CacheService } from './CacheService';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ChatCompletion } from 'openai/resources/chat/completions';

interface Question {
    index: string;
    question: string;
}

export interface CrawlerResult {
    question: Question;
    answer: string;
    visitedUrls: string[];
}

export class WebCrawler {
    private readonly pageScraper: PageScraper;
    private readonly openAIService: OpenAIService;
    private readonly baseUrl: string;
    private readonly maxDepth: number;

    constructor(
        requestService: RequestService,
        cacheService: CacheService,
        openAIService: OpenAIService,
        baseUrl: string = 'https://softo.ag3nts.org',
        maxDepth: number = 3
    ) {
        this.pageScraper = new PageScraper(requestService, cacheService);
        this.openAIService = openAIService;
        this.baseUrl = baseUrl;
        this.maxDepth = maxDepth;
    }

    private async checkForAnswer(page: Page, question: Question): Promise<string | null> {
        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: 'You are a helpful assistant that analyzes web content to find answers to questions. If you can answer the question based on the provided content, provide the answer. If you cannot answer it, respond with "NO_ANSWER".'
            },
            {
                role: 'user',
                content: `Question: ${question.question}\n\nContent:\n${page.markdown}`
            }
        ];

        const response = await this.openAIService.completion({ messages }) as ChatCompletion;
        const answer = response.choices[0]?.message?.content;
        return answer === "NO_ANSWER" ? null : answer;
    }

    private async selectNextLink(page: Page, question: Question): Promise<string | null> {
        if (page.links.length === 0) {
            return null;
        }

        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: 'You are a helpful assistant that analyzes web content and available links to determine which link is most likely to lead to an answer. If none of the links seem relevant, respond with "NO_RELEVANT_LINK".'
            },
            {
                role: 'user',
                content: `Question: ${question.question}\n\nContent:\n${page.markdown}\n\nAvailable links:\n${page.links.map(link => `- ${link}`).join('\n')}`
            }
        ];

        const response = await this.openAIService.completion({ messages }) as ChatCompletion;
        const selectedLink = response.choices[0]?.message?.content;
        return selectedLink === "NO_RELEVANT_LINK" ? null : selectedLink;
    }

    async crawlPage(url: string, question: Question, visitedUrls: string[] = []): Promise<CrawlerResult | null> {
        // Check if we've reached max depth or already visited this URL
        if (visitedUrls.length >= this.maxDepth || visitedUrls.includes(url)) {
            return null;
        }

        // Add current URL to visited list
        visitedUrls.push(url);

        // Scrape the page
        const page = await this.pageScraper.scrapePage(url);

        // Check if we can answer the question with current page
        const answer = await this.checkForAnswer(page, question);
        if (answer) {
            return {
                question,
                answer,
                visitedUrls
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
        return this.crawlPage(nextUrl, question, visitedUrls);
    }

    async startCrawling(question: Question): Promise<CrawlerResult | null> {
        return this.crawlPage(this.baseUrl, question);
    }
} 