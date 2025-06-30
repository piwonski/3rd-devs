import path from "path";
import { CacheService } from "../shared/CacheService";
import { HeadquartersService } from "../shared/HeadquartersService";
import { RequestService } from "../shared/RequestService";
import { UnicodeUtils } from "../shared/UnicodeUtils";
import { Environment } from "../shared/Environment";
import { DownloadService } from "../shared/DownloadService";
import { UnzipService } from "../shared/UnzipService";

export class Agent {

    private readonly requestService: RequestService;
    private readonly headquartersService: HeadquartersService;
    private readonly unicodeUtils: UnicodeUtils;
    private readonly cacheService: CacheService;
    private readonly downloadService: DownloadService;
    private readonly unzipService: UnzipService;
    private readonly cacheDir: string;

    constructor() {
        this.cacheDir = path.join(__dirname, 'cache');
        this.requestService = new RequestService();
        this.headquartersService = new HeadquartersService(this.requestService);
        this.unicodeUtils = new UnicodeUtils();
        this.cacheService = new CacheService(this.cacheDir);
        this.downloadService = new DownloadService(this.cacheDir);
        this.unzipService = new UnzipService(this.cacheDir);
        this.cacheService.ensureCacheDirectory();
    }

    private async downloadAndUnzip(fileName: string, password?: string) {
        if (!await this.cacheService.fileExists(fileName)) {
            const zipUrl = `${Environment.getHeadquartersHost()}/dane/${fileName}`;
            console.log("📥 Downloading", fileName, "...");
            await this.downloadService.downloadFile(zipUrl, fileName);
            console.log("✅", fileName, "downloaded");

            console.log("📦 Unzipping", fileName, "...");
            await this.unzipService.unzipFile({ zipPaths: [fileName], password });
            console.log("✅", fileName, "unzipped");
        }
    }

    private async downloadAndUnzipDependencies() {
        await this.downloadAndUnzip('pliki_z_fabryki.zip', Environment.getFilesFromFactoryZipPassword());
        await this.downloadAndUnzip('przesluchania.zip');
        await this.downloadAndUnzip('zygfryd_notatnik.zip');

        await this.cacheService.getOrFetch('arxiv-draft.html', async () => {
            console.log("📥 Downloading arxiv draft...");
            return await this.headquartersService.getArxivHtml();
        });

        await this.cacheService.getOrFetch('blog_rafala.html', async () => {
            console.log("📥 Downloading Blog Rafala...");
            return await this.requestService.getText('https://rafal.ag3nts.org/blogXYZ/');
        });


        // There is also a https://softo.ag3nts.org/ website, but we need to use WebCrawler to get the data from

        await this.cacheService.getOrFetch('phone_sorted.json', async () => {
            console.log("📥 Downloading phone sorted transcriptions...");
            return await this.headquartersService.getSortedPhoneTranscriptions();
        });
    }

    async run() {
        console.log("🤖 Agent running...");

        const storyQuestions = await this.cacheService.getOrFetch('story_questions.json', async () => {
            const data = await this.headquartersService.getStoryQuestions();
            const parsedData = JSON.parse(data);
            return this.unicodeUtils.decodeUnicode(parsedData);
        });
        console.log("🤖 Story questions:", storyQuestions);
        
        await this.downloadAndUnzipDependencies();
    }
}