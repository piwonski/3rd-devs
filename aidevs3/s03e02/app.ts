import * as path from 'path';
import { DownloadService } from '../shared/DownloadService';
import { UnzipService } from '../shared/UnzipService';
import { Environment } from '../shared/Environment';
import { OpenAIService } from '../shared/OpenAIService';
import { VectorService } from '../shared/VectorService';
import { TextSplitter } from '../shared/TextSplitter';
import type { IDoc } from '../shared/TextSplitter';
import { CacheService } from '../shared/CacheService';
import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';

const cacheDir = path.join(__dirname, 'cache');
const downloadService = new DownloadService(cacheDir);
const unzipService = new UnzipService(cacheDir);
const cacheService = new CacheService(cacheDir);

const openAIService = new OpenAIService();
const vectorService = new VectorService(openAIService, cacheDir);
const textSplitter = new TextSplitter();

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

function extractDateFromFilename(filename: string): string | null {
    const dateMatch = filename.match(/^(\d{4})[-_](\d{2})[-_](\d{2})/);
    return dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
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

    if (await vectorService.getCount('factory_data') === 0) {
        await insertVectors();
    }

    const query = 'W raporcie, z którego dnia znajduje się wzmianka o kradzieży prototypu broni?';
    console.log('\n\n', query, '\n\n');

    const results = await vectorService.performSearch('factory_data', query, {}, 1);
    console.log('Results: ', results);

    if (results?.[0]?.payload?.date) {
        const date = results[0].payload.date as string;
        const headquartersAnswer = await headquartersService.report('wektory', date);
        console.log('Answer: ', headquartersAnswer);
    } else {
        console.log('No results found');
    }
}

async function insertVectors() {
    const weaponReports = await cacheService.listFiles('weapons_tests', 'do-not-share');
    const docs = (await Promise.all(weaponReports.map(async (reportFileName) => {
        const date = extractDateFromFilename(reportFileName);
        const reportContent = await cacheService.readFile('weapons_tests', 'do-not-share', reportFileName);
        if (!reportContent) {
            console.error('Could not read report file: ', reportFileName);
            return null;
        }
        return await textSplitter.document(reportContent, 'gpt-4o', {date, filename: reportFileName});
    }))).filter((doc): doc is IDoc => doc !== null);

    console.log('Adding points to factory_data...');
    await vectorService.addPoints('factory_data', docs);
    console.log('Completed. Added ', docs.length, ' points.');
}

await main();