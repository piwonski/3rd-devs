export class Environment {
    public static getHeadquartersHost(): string {
        return this.getEnvironmentVariable("CENTRALA_HOST");
    }

    public static getCentralaApiKey(): string {
        return this.getEnvironmentVariable("CENTRALA_API_KEY");
    }

    public static getGroqApiKey(): string {
        return this.getEnvironmentVariable("GROQ_API_KEY");
    }

    public static getFilesFromFactoryZipPassword(): string {
        return this.getEnvironmentVariable("FILES_FROM_FACTORY_ZIP_PASSWORD");
    }

    private static getEnvironmentVariable(name: string): string {
        const value = process.env[name];
        if (!value) {
            throw new Error(`${name} is not set`);
        }
        return value;
    }
}
