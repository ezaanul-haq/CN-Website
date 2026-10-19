import { Router, type IRouter } from "express";
import civilRouter from "./civil";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(civilRouter);

export default router;
