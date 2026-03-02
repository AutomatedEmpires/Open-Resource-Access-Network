import * as cheerio from 'cheerio';

import {
  type TextExtractionOptions,
  TextExtractionOptionsSchema,
  type TextExtractionResult,
} from './types';

// Re-export cheerio types for internal use
type CheerioAPI = ReturnType<typeof cheerio.load>;
type CheerioSelection = ReturnType<CheerioAPI>;

/**
 * HtmlTextExtractor extracts clean, readable text from HTML content
 * using cheerio for parsing. It removes navigation, scripts, and other
 * non-content elements while preserving the semantic structure.
 */
export class HtmlTextExtractor {
  private readonly options: TextExtractionOptions;

  constructor(options: Partial<TextExtractionOptions> = {}) {
    this.options = TextExtractionOptionsSchema.parse(options);
  }

  /**
   * Extract readable text from HTML content.
   */
  extract(html: string): TextExtractionResult {
    const $ = cheerio.load(html);

    // Extract metadata before removing elements
    const title = this.extractTitle($);
    const metaDescription = this.extractMetaDescription($);
    const language = this.extractLanguage($);

    // Remove unwanted elements
    for (const selector of this.options.removeSelectors) {
      $(selector).remove();
    }

    // Try to find main content area first
    let text: string;
    let usedMainContentSelector = false;

    for (const selector of this.options.mainContentSelectors) {
      const mainContent = $(selector).first();
      if (mainContent.length > 0) {
        text = this.extractTextFromElement($, mainContent);
        if (text.trim().length > 100) {
          // Only use if substantial content
          usedMainContentSelector = true;
          break;
        }
      }
    }

    // Fall back to body if no main content found
    if (!usedMainContentSelector) {
      text = this.extractTextFromElement($, $('body'));
    }

    // Clean and normalize the text
    text = this.normalizeText(text!);

    // Truncate if necessary
    if (text.length > this.options.maxTextLength) {
      text = text.substring(0, this.options.maxTextLength);
      // Try to truncate at a word boundary
      const lastSpace = text.lastIndexOf(' ');
      if (lastSpace > this.options.maxTextLength * 0.8) {
        text = text.substring(0, lastSpace) + '...';
      }
    }

    const wordCount = this.countWords(text);

    return {
      text,
      title,
      metaDescription,
      language,
      usedMainContentSelector,
      wordCount,
    };
  }

  /**
   * Extract text from a cheerio element, preserving paragraph structure.
   */
  private extractTextFromElement($: CheerioAPI, element: CheerioSelection): string {
    if (this.options.preserveParagraphs) {
      return this.extractWithParagraphs($, element);
    }
    return element.text();
  }

  /**
   * Extract text while preserving paragraph breaks.
   */
  private extractWithParagraphs($: CheerioAPI, element: CheerioSelection): string {
    const parts: string[] = [];

    // Process block-level elements to preserve structure
    const blockElements = 'p, h1, h2, h3, h4, h5, h6, li, tr, div, section, article, blockquote, dd, dt';

    element.find(blockElements).each((_, el) => {
      const $el = $(el);
      // Only get direct text to avoid duplication from nested blocks
      const text = $el
        .contents()
        .filter((_, node) => {
          return node.type === 'text' || (node.type === 'tag' && !$(node).is(blockElements));
        })
        .text()
        .trim();

      if (text) {
        parts.push(text);
      }
    });

    // If no block elements found, fall back to raw text
    if (parts.length === 0) {
      return element.text();
    }

    return parts.join('\n\n');
  }

  /**
   * Extract page title from HTML.
   */
  private extractTitle($: CheerioAPI): string | undefined {
    // Try <title> first
    const titleTag = $('title').first().text().trim();
    if (titleTag) {
      return titleTag;
    }

    // Try og:title
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
    if (ogTitle) {
      return ogTitle;
    }

    // Try h1
    const h1 = $('h1').first().text().trim();
    if (h1) {
      return h1;
    }

    return undefined;
  }

  /**
   * Extract meta description from HTML.
   */
  private extractMetaDescription($: CheerioAPI): string | undefined {
    // Standard meta description
    const metaDesc = $('meta[name="description"]').attr('content')?.trim();
    if (metaDesc) {
      return metaDesc;
    }

    // og:description
    const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
    if (ogDesc) {
      return ogDesc;
    }

    return undefined;
  }

  /**
   * Extract language from HTML.
   */
  private extractLanguage($: CheerioAPI): string | undefined {
    // html lang attribute
    const htmlLang = $('html').attr('lang')?.trim();
    if (htmlLang) {
      return htmlLang;
    }

    // Content-Language meta
    const metaLang = $('meta[http-equiv="Content-Language"]').attr('content')?.trim();
    if (metaLang) {
      return metaLang;
    }

    return undefined;
  }

  /**
   * Normalize extracted text.
   */
  private normalizeText(text: string): string {
    return (
      text
        // Normalize whitespace
        .replace(/[\t ]+/g, ' ')
        // Normalize line breaks
        .replace(/\r\n/g, '\n')
        // Collapse multiple blank lines
        .replace(/\n{3,}/g, '\n\n')
        // Trim lines
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        // Final trim
        .trim()
    );
  }

  /**
   * Count words in text.
   */
  private countWords(text: string): number {
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    return words.length;
  }
}

/**
 * Factory function to create an HtmlTextExtractor with default options.
 */
export function createHtmlTextExtractor(options: Partial<TextExtractionOptions> = {}): HtmlTextExtractor {
  return new HtmlTextExtractor(options);
}

/**
 * Convenience function to extract text from HTML in one call.
 */
export function extractTextFromHtml(
  html: string,
  options: Partial<TextExtractionOptions> = {}
): TextExtractionResult {
  return new HtmlTextExtractor(options).extract(html);
}
