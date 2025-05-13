import express from "express";

const app = express();
const host = process.env.AZYL_HOST || "invalid_host";
const port = 3000;
app.use(express.json());


app.listen(port, () => console.log(`Server running at ${host}:${port}. Listening for POST /api/hello requests`));

app.post('/api/hello', async (req, res) => {
    const inputMessage = req.body.message;
    res.json({
        message: `${inputMessage} Nice to meet you!`
    });
});