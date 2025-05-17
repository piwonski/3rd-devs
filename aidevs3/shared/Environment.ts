export class Environment {
    public static getHeadquartersHost(): string {
        return this.getEnvironmentVariable("CENTRALA_HOST");
    }

    public static getCentralaApiKey(): string {
        return this.getEnvironmentVariable("CENTRALA_API_KEY");
    }

    private static getEnvironmentVariable(name: string): string {
        const value = process.env[name];
        if (!value) {
            throw new Error(`${name} is not set`);
        }
        return value;
    }
}
