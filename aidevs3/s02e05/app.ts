import { Environment } from '../shared/Environment';
import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { HtmlToMarkdownConverter } from '../shared/HtmlToMarkdownConverter';

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const htmlToMarkdownConverter = new HtmlToMarkdownConverter();

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
        const markdown = await htmlToMarkdownConverter.convert(article);
        
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