/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Visitor's language from the wcag_lang cookie: 'nl' or 'en'. */
    lang?: string;
    /** Set by a translated page; the layout and header follow it. */
    pageLang?: string;
    access?: {
      role?: string;
      userId?: string;
      email?: string;
      csrf?: string;
      ver?: number;
    } | null;
  }
}

export {};
