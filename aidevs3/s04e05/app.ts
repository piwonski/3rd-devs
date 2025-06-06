import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { CacheService } from '../shared/CacheService';
import { OpenAIService } from '../shared/OpenAIService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

// Use require for pdf-parse-debugging-disabled to avoid type issues
const pdfParse = require('pdf-parse-debugging-disabled');
const execAsync = promisify(exec);

class PdfProcessor {
    private openaiService: OpenAIService;
    private cacheService: CacheService;

    constructor(openaiService: OpenAIService, cacheService: CacheService) {
        this.openaiService = openaiService;
        this.cacheService = cacheService;
    }

    async extractTextFromPdf(pdfPath: string): Promise<{ pages1to18: string, page19Text: string }> {
        // Extract text from pages 1-18
        console.log('📄 Extracting text from pages 1-18...');
        const pages1to18Text = await this.cacheService.getOrFetch('pdf-text-pages-1-18.txt', async () => {
            const dataBuffer = fs.readFileSync(pdfPath);
            const data = await pdfParse(dataBuffer);
            return data.text;
        });

        // Process page 19 with OCR
        console.log('🖼️ Processing page 19 with OCR...');
        const page19Text = await this.cacheService.getOrFetch('pdf-page-19-ocr.txt', async () => {
            try {
                console.log('🔄 Starting PDF page conversion...');
                
                // Use ImageMagick directly to convert page 19 (index 18) to PNG
                const imagePath = path.join(path.dirname(pdfPath), 'page19.png');
                const command = `magick "${pdfPath}[18]" -density 300 -resize 2000x2000 -quality 95 "${imagePath}"`;
                
                console.log(`📝 Running command: ${command}`);
                await execAsync(command);
                console.log('✅ PDF page converted successfully');
                
                // Use OpenAI Vision to extract text from the image
                console.log('👁️ Using AI vision to extract text from page 19...');
                const base64Image = fs.readFileSync(imagePath, 'base64');
                console.log(`📏 Base64 image size: ${base64Image.length} characters`);
                
                const prompt = `Jesteś ekspertem OCR. Przeanalizuj ten obraz, który zawiera odręczne notatki w języku polskim. 
                Wyekstrahuj cały tekst z tego obrazu jak najdokładniej. 
                Zwróć odpowiedź w formacie JSON z polem "preview" zawierającym wyekstrahowany tekst.
                Jeśli jakieś słowa są nieczytelne, oznacz je jako [NIECZYTELNE].`;

                console.log('🤖 Calling OpenAI Vision API...');
                const result = await this.openaiService.processImageWithPrompt(base64Image, prompt, 'page19');
                console.log('✅ OpenAI Vision API completed');
                
                return result.preview;
            } catch (error) {
                console.error('❌ Error during page 19 processing:', error);
                throw error;
            }
        });

        return {
            pages1to18: pages1to18Text,
            page19Text: page19Text
        };
    }
}

class App {
    private requestService: RequestService;
    private headquartersService: HeadquartersService;
    private cacheService: CacheService;
    private openaiService: OpenAIService;
    private expenseCounter: ExpenseCounter;
    private pdfProcessor: PdfProcessor;
    private cacheDir: string;

    constructor() {
        this.requestService = new RequestService();
        this.headquartersService = new HeadquartersService(this.requestService);
        this.cacheDir = path.join(__dirname, 'cache');
        this.cacheService = new CacheService(this.cacheDir);
        this.expenseCounter = new ExpenseCounter();
        this.openaiService = new OpenAIService(3072, this.expenseCounter);
        this.pdfProcessor = new PdfProcessor(this.openaiService, this.cacheService);
        this.cacheService.ensureCacheDirectory();
    }

    async run() {
        try {
            console.log('🚀 Starting data download and processing...\n');
            console.log('💰 Expense tracking initialized\n');

            // Ensure cache directory exists
            await this.cacheService.ensureCacheDirectory();

            // Download or get from cache Rafał's notebook (PDF)
            console.log('📖 Getting Rafał\'s notebook (PDF)...');
            const pdfUrl = 'https://c3ntrala.ag3nts.org/dane/notatnik-rafala.pdf';
            const pdfPath = path.join(this.cacheDir, 'notatnik-rafala.pdf');
            
            if (!fs.existsSync(pdfPath)) {
                console.log('📥 Downloading PDF from server...');
                const pdfBuffer = await this.downloadBinaryFile(pdfUrl);
                fs.writeFileSync(pdfPath, pdfBuffer);
                console.log('✅ PDF downloaded and cached');
            } else {
                console.log('📦 Using cached PDF file');
            }

            // Process PDF content
            console.log('\n🔍 Processing PDF content...');
            const pdfContent = await this.pdfProcessor.extractTextFromPdf(pdfPath);

            // Save processed content
            const fullContentPath = path.join(this.cacheDir, 'notatnik-full-content.txt');
            const fullContent = `=== STRONY 1-18 (TEKST) ===\n\n${pdfContent.pages1to18}\n\n=== STRONA 19 (OCR) ===\n\n${pdfContent.page19Text}`;
            fs.writeFileSync(fullContentPath, fullContent);
            console.log(`✅ Full PDF content saved to: ${fullContentPath}`);

            // Get API key and download or get from cache questions (JSON)
            console.log('\n📋 Getting questions list (JSON)...');
            const apiKey = process.env.CENTRALA_API_KEY;
            if (!apiKey) {
                throw new Error('CENTRALA_API_KEY environment variable is not set');
            }
            
            const questionsUrl = `https://c3ntrala.ag3nts.org/data/${apiKey}/notes.json`;
            const questionsDataString = await this.cacheService.getOrFetch('notes.json', async () => {
                console.log('📥 Fetching questions from API...');
                const data = await this.requestService.get(questionsUrl);
                return JSON.stringify(data, null, 2);
            });
            
            const questionsData = JSON.parse(questionsDataString);
            
            // Display final results and costs
            this.displayResults(pdfContent, questionsData);

        } catch (error) {
            console.error('❌ Error:', error);
            process.exit(1);
        }
    }

    private displayResults(pdfContent: any, questionsData: any) {
        console.log('\n🎉 All files ready in cache directory!');
        console.log('\nAvailable files:');
        console.log('- ./cache/notatnik-rafala.pdf (Original PDF)');
        console.log('- ./cache/notatnik-full-content.txt (Extracted text from all pages)');
        console.log('- ./cache/notes.json (Questions list)');

        // Display content preview
        console.log('\n📖 PDF Content Preview:');
        console.log(`Pages 1-18 text length: ${pdfContent.pages1to18.length} characters`);
        console.log(`Page 19 OCR text: ${pdfContent.page19Text.substring(0, 200)}...`);

        // Display questions preview
        if (Array.isArray(questionsData)) {
            console.log(`\n📝 Found ${questionsData.length} questions:`);
            questionsData.slice(0, 5).forEach((question: any, index: number) => {
                console.log(`${index + 1}. ${question}`);
            });
            if (questionsData.length > 5) {
                console.log(`... and ${questionsData.length - 5} more questions`);
            }
        }

        // Display cost summary
        const tokens = this.expenseCounter.getUsedTokens();
        const costs = this.expenseCounter.getEstimatedCost('gpt-4.1'); // Most calls use gpt-4.1
        
        console.log('\n💰 Cost Summary:');
        console.log(`Model: ${costs.model}`);
        console.log(`Input tokens: ${tokens.input.toLocaleString()}`);
        console.log(`Output tokens: ${tokens.output.toLocaleString()}`);
        console.log(`Total tokens: ${tokens.total.toLocaleString()}`);
        console.log(`Estimated cost: $${costs.totalCost.toFixed(4)} USD`);
        console.log(`  - Input: $${costs.inputCost.toFixed(4)} USD`);
        console.log(`  - Output: $${costs.outputCost.toFixed(4)} USD`);

        console.log('\n🎯 Ready to analyze PDF content against questions!');
    }

    private async downloadBinaryFile(url: string): Promise<Buffer> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download ${url}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        return Buffer.from(buffer);
    }
}

// Run the application
const app = new App();
app.run().catch(console.error);
