import { z } from "zod";

// The production CSP forbids Zod's optional Function-based schema JIT.
z.config({ jitless: true });
