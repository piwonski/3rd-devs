import { OpenAIService } from './OpenAIService';
import { PageScraper } from './PageScraper';
import type { Page, Link } from './PageScraper';
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
    visitedUrls: Set<string>;
}

export interface SupervisionContext {
    currentUrl: string;
    question: Question;
    visitedUrls: Set<string>;
    nextLink?: string;
    answer?: string;
}

export type SupervisionCallback = (context: SupervisionContext) => Promise<boolean>;

export class WebCrawler {
    private readonly pageScraper: PageScraper;
    private readonly openAIService: OpenAIService;
    private readonly baseUrl: string;
    private readonly maxDepth: number;
    private readonly supervisionCallback?: SupervisionCallback;
    private visitedUrls: Set<string> = new Set();

    constructor(
        requestService: RequestService,
        cacheService: CacheService,
        openAIService: OpenAIService,
        baseUrl: string = 'https://softo.ag3nts.org',
        maxDepth: number = 3,
        supervisionCallback?: SupervisionCallback
    ) {
        this.pageScraper = new PageScraper(requestService, cacheService);
        this.openAIService = openAIService;
        this.baseUrl = baseUrl;
        this.maxDepth = maxDepth;
        this.supervisionCallback = supervisionCallback;
    }

    private async checkForAnswer(page: Page, question: Question): Promise<string | null> {
        console.log('Checking for answer on page: ', page.url);
        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: 'You are an answer extractor. Your ONLY job is to return EXACTLY the answer found in the content, or "NO_ANSWER". Do not explain, do not add any text. Just return the answer.'
            },
            {
                role: 'user',
                content: `Question: ${question.question}\n\nContent:\n${page.markdown}\n\nReturn EXACTLY the answer found in the content, or "NO_ANSWER".`
            }
        ];

        const response = await this.openAIService.completion({ messages }) as ChatCompletion;
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

        console.log('Available unvisited links on page:', page.url, unvisitedLinks);

        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: `You are a link selector. Your job is to select the most relevant link that might contain information related to the question.

Analyze the link information to understand what each link might contain. Consider:
- The meaning of the link text
- The title attribute which often provides additional context
- The relationship between the question and potential content

Return EXACTLY one of the available links, or "NO_RELEVANT_LINK" if none seem relevant. Do not explain, just return the link.`
            },
            {
                role: 'user',
                content: `Question: ${question.question}

Available links:\n${unvisitedLinks.map(link => 
    `- ${link.href} (${link.text}${link.title ? ` - ${link.title}` : ''})`
).join('\n')}

Return EXACTLY one of these links, or "NO_RELEVANT_LINK".`
            }
        ];

        const response = await this.openAIService.completion({ messages }) as ChatCompletion;
        const selectedLink = response.choices[0]?.message?.content?.trim() ?? null;
        
        if (!selectedLink || selectedLink === "NO_RELEVANT_LINK") {
            console.log('No relevant link selected for question:', question.question);
            return null;
        }

        // Find the exact match from available links
        const exactMatch = unvisitedLinks.find(link => link.href === selectedLink);
        if (exactMatch) {
            console.log('Selected link:', exactMatch.href, 'with text:', exactMatch.text, exactMatch.title ? `and title: ${exactMatch.title}` : '');
            return exactMatch.href;
        }

        console.warn('Invalid link selection:', selectedLink);
        return null;
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

        // Check if we can answer the question with current page
        const answer = await this.checkForAnswer(page, question);
        if (answer) {
            // Ask for supervision if callback is provided
            if (this.supervisionCallback) {
                const shouldContinue = await this.supervisionCallback({
                    currentUrl: url,
                    question,
                    visitedUrls: this.visitedUrls,
                    answer
                });
                if (!shouldContinue) {
                    return null;
                }
            }

            return {
                question,
                answer,
                visitedUrls: this.visitedUrls
            };
        }

        // If we can't answer, select next link to visit
        const nextLink = await this.selectNextLink(page, question);
        if (!nextLink) {
            return null;
        }

        // Construct full URL for the next link
        const nextUrl = new URL(nextLink, this.baseUrl).toString();

        // Ask for supervision if callback is provided
        if (this.supervisionCallback) {
            const shouldContinue = await this.supervisionCallback({
                currentUrl: url,
                question,
                visitedUrls: this.visitedUrls,
                nextLink: nextUrl
            });
            if (!shouldContinue) {
                return null;
            }
        }

        // Recursively crawl the next page
        return this.crawlPage(nextUrl, question);
    }

    async startCrawling(question: Question): Promise<CrawlerResult | null> {
        // Reset visited URLs for each new crawl
        this.visitedUrls.clear();
        return this.crawlPage(this.baseUrl, question);
    }
} 