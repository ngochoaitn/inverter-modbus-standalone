import type { MetadataRoute } from 'next';

// Private local dashboard — block every crawler from indexing anything.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
