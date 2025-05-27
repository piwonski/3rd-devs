import * as fs from 'fs';
import * as path from 'path';
import Seven from 'node-7z';

export class UnzipService {
    private cacheDir: string;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
    }

    async unzipFile({ zipPaths, password }: { zipPaths: string[]; password?: string }): Promise<void> {
        try {
            const zipFile = path.join(this.cacheDir, ...zipPaths);
            const zipFileName = path.basename(zipPaths[zipPaths.length - 1], '.zip');
            const extractDir = path.join(this.cacheDir, zipFileName);
            console.log(`Unzipping file... ${zipFile}`);
            
            await fs.promises.mkdir(extractDir, { recursive: true });
            
            await new Promise<void>((resolve, reject) => {
                const options = ['x', zipFile, `-o${extractDir}`];
                if (password) {
                    options.push(`-p${password}`);
                }
                
                const seven = Seven.extractFull(zipFile, extractDir, {
                    password,
                    recursive: true
                });
                
                seven.on('end', () => {
                    console.log('Unzip completed successfully!');
                    resolve();
                });
                
                seven.on('error', reject);
            });
        } catch (error) {
            console.error('Error in unzipFile:', error);
            throw error;
        }
    }
} 