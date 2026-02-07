import express from "express";
import cors from "cors";

const app = express();
const port = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});
