const cors = require("cors");
const express = require("express");
const routes = require("./routes");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

const corsOptions = {
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use("/api", routes);
app.use(errorHandler);

module.exports = app;
