/**
 * NodeNamer — Generates semantic, human-readable layer names for Figma.
 */

const SEMANTIC_TAG_NAMES: Record<string, string> = {
  header: 'Header', nav: 'Navigation', main: 'Main Content', footer: 'Footer',
  aside: 'Sidebar', section: 'Section', article: 'Article', form: 'Form',
  button: 'Button', input: 'Input', textarea: 'Text Area', select: 'Select',
  a: 'Link', ul: 'List', ol: 'Ordered List', li: 'List Item',
  table: 'Table', thead: 'Table Header', tbody: 'Table Body',
  tr: 'Table Row', td: 'Table Cell', th: 'Table Header Cell',
  img: 'Image', video: 'Video', audio: 'Audio', canvas: 'Canvas',
  dialog: 'Dialog', details: 'Details', summary: 'Summary',
  figure: 'Figure', figcaption: 'Caption', blockquote: 'Blockquote',
  code: 'Code', pre: 'Preformatted',
  h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
  h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
  p: 'Paragraph', span: 'Text', div: 'Container', label: 'Label',
};

export class NodeNamer {
  private nameCounters = new Map<string, number>();

  generateName(element: Element, tagName: string, depth: number): string {
    // 1. Check aria-label first (most descriptive)
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return this.uniquify(ariaLabel.substring(0, 40));

    // 2. Check for common component patterns in class names
    const className = typeof element.className === 'string' ? element.className : '';
    const componentName = this.extractComponentName(className);
    if (componentName) return this.uniquify(componentName);

    // 3. Check data attributes
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
    if (testId) return this.uniquify(this.humanize(testId));

    // 4. Use semantic tag name
    const semantic = SEMANTIC_TAG_NAMES[tagName];
    if (semantic) {
      // For buttons and links, include text content
      if (tagName === 'button' || tagName === 'a') {
        const text = element.textContent?.trim().substring(0, 30);
        if (text) return this.uniquify(`${semantic}: ${text}`);
      }
      return this.uniquify(semantic);
    }

    // 5. Use ID if present
    if (element.id) return this.uniquify(this.humanize(element.id));

    // 6. Use role attribute
    const role = element.getAttribute('role');
    if (role) return this.uniquify(this.humanize(role));

    // 7. Fallback: use class name or generic
    if (className) {
      const firstClass = className.split(/\s+/)[0];
      if (firstClass && !this.isUtilityClass(firstClass)) {
        return this.uniquify(this.humanize(firstClass));
      }
    }

    return this.uniquify('Frame');
  }

  private extractComponentName(className: string): string | null {
    if (!className) return null;

    const classes = className.split(/\s+/);
    for (const cls of classes) {
      // BEM-style: block__element--modifier → "Block Element"
      const bemMatch = cls.match(/^([a-z][\w-]*?)(?:__([a-z][\w-]*))?(?:--([a-z][\w-]*))?$/i);
      if (bemMatch && bemMatch[1] && !this.isUtilityClass(bemMatch[1])) {
        const block = this.humanize(bemMatch[1]);
        const element = bemMatch[2] ? ` ${this.humanize(bemMatch[2])}` : '';
        return `${block}${element}`;
      }
    }

    return null;
  }

  private humanize(str: string): string {
    return str
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim()
      .substring(0, 40);
  }

  private isUtilityClass(cls: string): boolean {
    // Common utility class patterns (Tailwind, Bootstrap, etc.)
    const patterns = [
      /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky)$/,
      /^(w-|h-|p-|m-|px-|py-|mx-|my-|pt-|pb-|pl-|pr-|mt-|mb-|ml-|mr-)/,
      /^(text-|bg-|border-|rounded-|shadow-|font-|leading-|tracking-)/,
      /^(sm:|md:|lg:|xl:|2xl:)/,
      /^(col-|row-|gap-|space-|justify-|items-|self-|order-)/,
      /^(overflow-|z-|opacity-|transition-|transform-|cursor-)/,
      /^(d-|col-|container|row)$/, // Bootstrap
      /^(css-|sc-|emotion-)/, // CSS-in-JS
    ];
    return patterns.some((p) => p.test(cls));
  }

  private uniquify(name: string): string {
    const count = this.nameCounters.get(name) || 0;
    this.nameCounters.set(name, count + 1);
    return count === 0 ? name : `${name} ${count + 1}`;
  }
}
