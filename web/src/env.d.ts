/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
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
