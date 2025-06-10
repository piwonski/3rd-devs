import { HeadquartersService } from "../shared/HeadquartersService";
import { RequestService } from "../shared/RequestService";
import { CacheService } from "../shared/CacheService";
import { Environment } from "../shared/Environment";
import { OpenAIService } from "../shared/OpenAIService";
import { ExpenseCounter } from "../shared/ExpenseCounter";
import * as path from 'path';
import { DownloadService } from "../shared/DownloadService";
import { UnzipService } from "../shared/UnzipService";

// Function to decode Unicode escape sequences
const decodeUnicode = (obj: any): any => {
    if (typeof obj === 'string') {
        return obj.replace(/\\u[\dA-F]{4}/gi, (match) => 
            String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16))
        );
    } else if (Array.isArray(obj)) {
        return obj.map(decodeUnicode);
    } else if (obj && typeof obj === 'object') {
        const decoded: any = {};
        for (const [key, value] of Object.entries(obj)) {
            decoded[key] = decodeUnicode(value);
        }
        return decoded;
    }
    return obj;
};

interface AgentContext {
    factSummaries: Record<string, string>;
    phoneTranscriptions: Record<string, string>;
}

interface AgentState {
    context: AgentContext;
    questions: Record<string, string>;
}

export class Agent {
    private readonly requestService: RequestService;
    private readonly headquartersService: HeadquartersService;
    private readonly cacheService: CacheService;
    private readonly downloadService: DownloadService;
    private readonly unzipService: UnzipService;
    private readonly openAIService: OpenAIService;
    private readonly expenseCounter: ExpenseCounter;

    constructor() {
        const cacheDir = path.join(__dirname, 'cache');
        this.requestService = new RequestService();
        this.headquartersService = new HeadquartersService(this.requestService);
        this.cacheService = new CacheService(cacheDir);
        this.downloadService = new DownloadService(cacheDir);
        this.unzipService = new UnzipService(cacheDir);
        this.expenseCounter = new ExpenseCounter();
        this.openAIService = new OpenAIService(3072, this.expenseCounter);
        console.log(`📁 Using cache directory: ${cacheDir}`);
    }

    async run() {
        try {
            console.log("🚀 Agent starting...");
            
            await this.prepareContext();
            
            // Show token usage
            console.log("💰 Token usage summary:");
            const usedTokens = this.expenseCounter.getUsedTokens();
            const costBreakdown = this.expenseCounter.getEstimatedCost('gpt-4.1');
            console.log(`📊 Tokens used - Input: ${usedTokens.input}, Output: ${usedTokens.output}, Total: ${usedTokens.total}`);
            console.log(`💵 Estimated cost: $${costBreakdown.totalCost.toFixed(4)} (${costBreakdown.model})`);
            
            console.log("✅ Agent completed successfully");
            
        } catch (error) {
            const errorInfo = error instanceof Error 
            ? { error: error.message, stack: error.stack }
            : { error: String(error) };
            console.log("❌ Agent failed with error", errorInfo);
            throw error;
        }
    }
    
    private async prepareContext() {
        // Ensure cache directory exists
        await this.cacheService.ensureCacheDirectory();

        console.log("📞 Fetching phone transcriptions...");
        const transcriptionsData = await this.cacheService.getOrFetchJson('phone-transcriptions.json', async () => {
            const data = await this.headquartersService.getPhoneTranscriptions();
            const parsed = JSON.parse(data);
            return decodeUnicode(parsed);
        });
        console.log("✅ Phone transcriptions received", { count: Object.keys(transcriptionsData).length });
        console.log("📞 Phone transcriptions:", transcriptionsData);

        console.log("❓ Fetching phone questions...");
        const questionsData = await this.cacheService.getOrFetchJson('phone-questions.json', async () => {
            const data = await this.headquartersService.getPhoneQuestions();
            const parsed = JSON.parse(data);
            return decodeUnicode(parsed);
        });
        console.log("✅ Phone questions received", { count: Object.keys(questionsData).length });
        console.log("❓ Phone questions:", questionsData);

        // Download and unzip factory files
        await this.downloadAndUnzipPlikiZFabryki();

        // Read all fact files
        const facts: Record<string, string> = await this.readFacts();

        console.log("✅ Facts loaded", { count: Object.keys(facts).length });
        console.log("📚 Facts:", facts);

        // Create summaries of facts
        const factSummaries = await this.cacheService.getOrFetchJson('fact-summaries.json', async () => {
            return await this.createFactSummaries(facts);
        });
        console.log("✅ Fact summaries ready");
        console.log("📝 Fact summaries:", factSummaries);

        console.log("📋 Data summary completed");
        return {
            factSummaries,
            phoneTranscriptions: transcriptionsData,
        }
    }

    private async downloadAndUnzipPlikiZFabryki() {
        if (!await this.cacheService.fileExists('pliki_z_fabryki.zip')) {
            const password = Environment.getFilesFromFactoryZipPassword();
            const zipUrl = `${Environment.getHeadquartersHost()}/dane/pliki_z_fabryki.zip`;
            const zipFileName = 'pliki_z_fabryki.zip';

            console.log("📥 Downloading factory files...");
            await this.downloadService.downloadFile(zipUrl, zipFileName);
            console.log("✅ Factory files downloaded");

            console.log("📦 Unzipping factory files...");
            await this.unzipService.unzipFile({ zipPaths: [zipFileName], password });
            console.log("✅ Factory files unzipped");
        } else {
            console.log("📁 Factory files already exist in cache");
        }
    }

    private async readFacts() {
        const facts: Record<string, string> = {};
        // Read facts from factory files
        console.log("📖 Reading facts from factory files...");
        const factFiles = await this.cacheService.listFiles('pliki_z_fabryki', 'facts');

        for (const factFile of factFiles.filter(f => f.endsWith('.txt'))) {
            const factContent = await this.cacheService.readFile('pliki_z_fabryki', 'facts', factFile);
            if (factContent) {
                const factKey = factFile.replace('.txt', '');
                facts[factKey] = factContent.trim();
                console.log(`📄 Loaded fact: ${factKey}`);
            }
        }
        return facts;
    }

    private async createFactSummaries(facts: Record<string, string>) {
        const summaries: Record<string, string> = {};
        console.log("🧠 Creating fact summaries...");
        
        const factsKeywordsPrompt = `
Read the following facts and extract key information. 
If the fact is about a person, provide also information about the person's identity, occupation, skills, names of technologies the person is familiar with, etc.
Use strict sentence structure. 
DON'T use bullet points, paragraphs, etc.
`;
        
        for (const [factKey, factContent] of Object.entries(facts)) {
            console.log(`🔍 Processing fact: ${factKey}`);
            
            const messages = [
                { role: "system" as const, content: factsKeywordsPrompt },
                { role: "user" as const, content: factContent }
            ];
            
            const response = await this.openAIService.completion({ messages });
            const summary = (response as any).choices[0].message.content || "";
            summaries[factKey] = summary.trim();
            
            console.log(`✅ Summary created for ${factKey}`);
        }
        
        return summaries;
    }
}

