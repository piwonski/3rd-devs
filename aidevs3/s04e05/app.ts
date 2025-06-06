import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { CacheService } from '../shared/CacheService';
import * as fs from 'fs';
import * as path from 'path';

class App {
    private requestService: RequestService;
    private headquartersService: HeadquartersService;
    private cacheService: CacheService;
    private cacheDir: string;

    constructor() {
        this.requestService = new RequestService();
        this.headquartersService = new HeadquartersService(this.requestService);
        this.cacheDir = path.join(__dirname, 'cache');
        this.cacheService = new CacheService(this.cacheDir);
        this.cacheService.ensureCacheDirectory();
    }

    async run() {
        try {
            console.log('🚀 Starting data download process...\n');

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

            // Get API key and download or get from cache questions (JSON)
            console.log('📋 Getting questions list (JSON)...');
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
            
            console.log('\n🎉 All files ready in cache directory!');
            console.log('\nAvailable files:');
            console.log('- ./cache/notatnik-rafala.pdf (Rafał\'s notebook)');
            console.log('- ./cache/notes.json (Questions list)');

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

        } catch (error) {
            console.error('❌ Error:', error);
            process.exit(1);
        }
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
