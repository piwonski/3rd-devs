import { CacheService } from '../shared/CacheService';
import { DownloadService } from '../shared/DownloadService';
import { HeadquartersService } from '../shared/HeadquartersService';
import { OpenAIService } from '../shared/OpenAIService';
import { RequestService } from '../shared/RequestService';
import { UnzipService } from '../shared/UnzipService';
import * as path from 'path';

export class Agent {
    private readonly requestService: RequestService;
    private readonly headquartersService: HeadquartersService;
    private readonly cacheService: CacheService;
    private readonly downloadService: DownloadService;
    private readonly unzipService: UnzipService;
    private readonly openAIService: OpenAIService;
    private readonly cacheDir: string;
    
    constructor() {
        this.cacheDir = path.join(__dirname, 'cache');
        this.requestService = new RequestService();
        this.headquartersService = new HeadquartersService(this.requestService);
        this.cacheService = new CacheService(this.cacheDir);
        this.downloadService = new DownloadService(this.cacheDir);
        this.unzipService = new UnzipService(this.cacheDir);
        this.openAIService = new OpenAIService();
    }

    async run() {
        console.log("🚀 Agent starting...");

        // Ensure cache directory exists
        await this.cacheService.ensureCacheDirectory();

        await this.prepareQuestions();

        console.log("✅ Agent completed successfully");
    }

    async prepareQuestions() {

        const question = await this.cacheService.getOrFetchJson('gps_questions.json', async () => {
            return await this.headquartersService.getGPSQuestion();
        });
        console.log("🔍 Question:", question);
    }
}