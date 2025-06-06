import * as fs from 'fs/promises';
import * as path from 'path';

export interface Serializer<T> {
    serialize(data: T): string;
    deserialize(data: string): T;
}

export class CacheService {
    private cacheDir: string;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
    }

    /**
     * Ensures the cache directory exists
     */
    async ensureCacheDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            console.error('Error creating cache directory:', error);
            throw error;
        }
    }

    /**
     * Reads the contents of a cached file
     * @param filename The name of the file to read
     * @returns The file contents as a string, or null if the file doesn't exist
     */
    async readFile(...paths: string[]): Promise<string | null> {
        const filePath = path.join(this.cacheDir, ...paths);
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    /**
     * Writes content to a cached file
     * @param filename The name of the file to write
     * @param content The content to write to the file
     */
    async writeFile(filename: string, content: string): Promise<void> {
        const filePath = path.join(this.cacheDir, filename);
        try {
            await fs.writeFile(filePath, content, 'utf-8');
        } catch (error) {
            console.error('Error writing to cache file:', error);
            throw error;
        }
    }

    /**
     * Lists all files in the cache directory
     * @returns Array of filenames in the cache directory
     */
    async listFiles(...paths: string[]): Promise<string[]> {
        const dirPath = path.join(this.cacheDir, ...paths);
        try {
            return await fs.readdir(dirPath);
        } catch (error) {
            console.error('Error listing cache files:', error);
            throw error;
        }
    }

    /**
     * Checks if a file exists in the cache
     * @param paths Path segments to join and check (e.g. ['dir', 'subdir', 'file.txt'])
     * @returns true if the file exists, false otherwise
     */
    async fileExists(...paths: string[]): Promise<boolean> {
        const filePath = path.join(this.cacheDir, ...paths);
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Deletes a file from the cache
     * @param filename The name of the file to delete
     */
    async deleteFile(filename: string): Promise<void> {
        const filePath = path.join(this.cacheDir, filename);
        try {
            await fs.unlink(filePath);
        } catch (error) {
            console.error('Error deleting cache file:', error);
            throw error;
        }
    }

    /**
     * Clears all files from the cache directory
     */
    async clearCache(): Promise<void> {
        try {
            const files = await this.listFiles();
            await Promise.all(files.map(file => this.deleteFile(file)));
        } catch (error) {
            console.error('Error clearing cache:', error);
            throw error;
        }
    }

    /**
     * Gets data from cache or fetches it using the provided callback (string version)
     * @param filename The name of the file to read/fetch
     * @param fetchCallback Callback function to fetch data if not in cache
     * @returns The file contents as a string
     */
    async getOrFetch(filename: string, fetchCallback: () => Promise<string>): Promise<string> {
        const cachedData = await this.readFile(filename);
        if (cachedData) {
            console.log(`📦 Using cached data for ${filename}`);
            return cachedData;
        }
        console.log(`💾 Caching fresh data for ${filename}`);
        const freshData = await fetchCallback();
        await this.writeFile(filename, freshData);
        return freshData;
    }

    /**
     * Gets typed data from cache or fetches it using the provided callback and serializer
     * @param filename The name of the file to read/fetch
     * @param fetchCallback Callback function to fetch data if not in cache
     * @param serializer Serializer to handle data conversion
     * @returns The typed data
     */
    async getOrFetchTyped<T>(
        filename: string, 
        fetchCallback: () => Promise<T>, 
        serializer: Serializer<T>
    ): Promise<T> {
        const cachedData = await this.readFile(filename);
        if (cachedData) {
            console.log(`📦 Using cached data for ${filename}`);
            return serializer.deserialize(cachedData);
        }
        console.log(`💾 Caching fresh data for ${filename}`);
        const freshData = await fetchCallback();
        const serializedData = serializer.serialize(freshData);
        await this.writeFile(filename, serializedData);
        return freshData;
    }

    /**
     * Gets JSON data from cache or fetches it
     */
    async getOrFetchJson<T>(filename: string, fetchCallback: () => Promise<T>): Promise<T> {
        return this.getOrFetchTyped(filename, fetchCallback, {
            serialize: (data: T) => JSON.stringify(data, null, 2),
            deserialize: (data: string) => JSON.parse(data)
        });
    }

    /**
     * Gets binary data from cache or fetches it
     */
    async getOrFetchBinary(filename: string, fetchCallback: () => Promise<Buffer>): Promise<Buffer> {
        return this.getOrFetchTyped(filename, fetchCallback, {
            serialize: (data: Buffer) => data.toString('base64'),
            deserialize: (data: string) => Buffer.from(data, 'base64')
        });
    }
} 