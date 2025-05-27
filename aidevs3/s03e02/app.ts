import * as path from 'path';
import { DownloadService } from '../shared/DownloadService';
import { UnzipService } from '../shared/UnzipService';
import { Environment } from '../shared/Environment';
import { OpenAIService } from '../shared/OpenAIService';
import { VectorService } from '../shared/VectorService';
import { TextSplitter } from '../shared/TextSplitter';
import type { IDoc } from '../shared/TextSplitter';
import { CacheService } from '../shared/CacheService';

const cacheDir = path.join(__dirname, 'cache');
const downloadService = new DownloadService(cacheDir);
const unzipService = new UnzipService(cacheDir);
const cacheService = new CacheService(cacheDir);

const openAIService = new OpenAIService();
const vectorService = new VectorService(openAIService, cacheDir);
const textSplitter = new TextSplitter();

function extractDateFromFilename(filename: string): string | null {
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})_/);
    return dateMatch ? dateMatch[1] : null;
}

async function main() {
    const password = Environment.getFilesFromFactoryZipPassword();
    if (!await cacheService.fileExists('pliki_z_fabryki.zip')) {
        const zipUrl = `${Environment.getHeadquartersHost()}/dane/pliki_z_fabryki.zip`;
        const zipFileName = 'pliki_z_fabryki.zip';

        await downloadService.downloadFile(zipUrl, zipFileName);
        await unzipService.unzipFile({ zipPaths: [zipFileName], password });
    }
    
    if (!await cacheService.fileExists('weapons_tests', 'do-not-share')) {
        await unzipService.unzipFile({ zipPaths: ['pliki_z_fabryki', 'weapons_tests.zip'], password });
    }
    await vectorService.ensureCollection('factory_data');

    const weaponReports = await cacheService.listFiles('weapons_tests', 'do-not-share');
    const docs = (await Promise.all(weaponReports.map(async (reportFileName) => {
        const date = extractDateFromFilename(reportFileName);
        const reportContent = await cacheService.readFile('weapons_tests', 'do-not-share', reportFileName);
        if (!reportContent) {
            console.error('Could not read report file: ', reportFileName);
            return null;
        }
        const result = await textSplitter.document(reportContent, 'gpt-4o', { date, filename: reportFileName});
        return result;
    }))).filter((doc): doc is IDoc => doc !== null);

    console.log('Adding points to factory_data...');
    await vectorService.addPoints('factory_data', docs);
    console.log('Completed. Added ', docs.length, ' points.');
}

await main();