import * as fs from 'fs';
import * as path from 'path';
import * as unzipper from 'unzipper';

export class UnzipService {
    private cacheDir: string;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
    }

    async unzipFile(zipFilePath: string, password: string): Promise<void> {
        try {
            console.log('Unzipping file...');
            const zipFile = path.join(this.cacheDir, zipFilePath);
            const zipFileName = path.basename(zipFilePath, '.zip');
            const extractDir = path.join(this.cacheDir, zipFileName);
            
            await fs.promises.mkdir(extractDir, { recursive: true });
            
            await new Promise((resolve, reject) => {
                fs.createReadStream(zipFile)
                    .pipe(unzipper.Parse({ password } as any))
                    .on('entry', async (entry: unzipper.Entry) => {
                        const filePath = path.join(extractDir, entry.path);
                        
                        if (entry.path.endsWith('/')) {
                            // Create directory
                            await fs.promises.mkdir(filePath, { recursive: true });
                            entry.autodrain();
                        } else {
                            // Ensure parent directory exists
                            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                            // Write file
                            entry.pipe(fs.createWriteStream(filePath));
                        }
                    })
                    .on('close', () => {
                        console.log('Unzip completed successfully!');
                        resolve(undefined);
                    })
                    .on('error', (err) => {
                        console.error('Error unzipping file:', err);
                        reject(err);
                    });
            });
        } catch (error) {
            console.error('Error in unzipFile:', error);
            throw error;
        }
    }
} 