import { Agent } from "./agent";

async function main() {
    const agent = new Agent();
    await agent.run();
}

main();