import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { checkSubscription } from '../middleware/checkSubscription';

const router = Router();

// Every /sync route needs a session and an active subscription.
router.use(requireAuth, checkSubscription);

export default router;
