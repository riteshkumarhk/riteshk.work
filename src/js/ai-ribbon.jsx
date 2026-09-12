import React from "react";
import { AI_REST_PATH } from "./ai-ribbon.mjs";

export function AiRibbonIcon({ size = 18 }) {
  return <svg className="ai-ribbon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={AI_REST_PATH} /></svg>;
}