declare module 'node-7z' {
    interface ExtractOptions {
        password?: string;
        recursive?: boolean;
    }

    interface SevenZip {
        extractFull(file: string, dest: string, options?: ExtractOptions): {
            on(event: 'end', callback: () => void): void;
            on(event: 'error', callback: (error: Error) => void): void;
        };
    }

    const Seven: SevenZip;
    export default Seven;
} 