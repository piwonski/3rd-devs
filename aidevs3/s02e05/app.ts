import { Environment } from '../shared/Environment';
import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import TurndownService from 'turndown';

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    bulletListMarker: '-',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    hr: '---'
});

function convertToAbsoluteUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http')) return url;
    return url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
}

function cleanHtml(html: string): string {
    // Remove style elements and their contents
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Remove HTML comments
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    
    // Convert relative URLs to absolute URLs
    const baseUrl = 'https://c3ntrala.ag3nts.org/dane';
    
    // Handle image sources
    html = html.replace(/<img[^>]+src="([^"]+)"[^>]*>/g, (match, src) => {
        const absoluteSrc = convertToAbsoluteUrl(src, baseUrl);
        return match.replace(src, absoluteSrc);
    });
    
    // Handle links
    html = html.replace(/<a[^>]+href="([^"]+)"[^>]*>/g, (match, href) => {
        const absoluteHref = convertToAbsoluteUrl(href, baseUrl);
        return match.replace(href, absoluteHref);
    });
    
    return html;
}

async function convertHtmlToMarkdown(html: string): Promise<string> {
    const cleanedHtml = cleanHtml(html);
    return turndownService.turndown(cleanedHtml);
}

async function main() {
    // Create cache directory if it doesn't exist
    const cacheDir = path.join(__dirname, 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
    
    // Fetch the article
    const article = await headquartersService.getArxivHtml();
    console.log('Article:', article);
    
    // Convert HTML to Markdown
    if (!fsSync.existsSync(path.join(cacheDir, 'article.md'))) {
        console.log('Converting HTML to Markdown...');
        const markdown = await convertHtmlToMarkdown(article);
        
        // Save to file
        const outputPath = path.join(cacheDir, 'article.md');
        await fs.writeFile(outputPath, markdown, 'utf-8');
        console.log('Article saved to:', outputPath);
    }
    // Fetch the questions
    const questions = await headquartersService.getArxivQuestions();
    console.log('Questions:', questions);
}

await main();