import { auth } from "../auth";
import { fromNodeHeaders } from "better-auth/node";

export const authMiddleware = async (req: any, res: any, next: any) => {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers)
    });

    if (!session) {
        return res.status(401).send("Unauthorized");
    }

    req.body.userId = session.user.id;
    req.body.user = session.user;
    next();
};
