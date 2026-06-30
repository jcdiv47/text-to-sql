"use client";

import { ConvexReactClient } from "convex/react";

/**
 * Shared Convex client so the React provider and the chat registry (which
 * persists messages from outside React) use the same authenticated connection.
 */
export const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
