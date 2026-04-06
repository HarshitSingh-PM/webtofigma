/**
 * LayoutAnalyzer — Detects and extracts layout information (flex, grid, positioning).
 */

import type { W2FAutoLayout, W2FConstraints } from './types';

export class LayoutAnalyzer {

  extractAutoLayout(style: CSSStyleDeclaration): W2FAutoLayout | undefined {
    const display = style.display;

    // Only extract auto-layout for flex containers
    if (display !== 'flex' && display !== 'inline-flex') {
      return undefined;
    }

    const direction = style.flexDirection;
    const justifyContent = style.justifyContent;
    const alignItems = style.alignItems;
    const flexWrap = style.flexWrap;

    return {
      direction: direction === 'row' || direction === 'row-reverse' ? 'HORIZONTAL' : 'VERTICAL',
      spacing: this.extractGap(style),
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
      paddingLeft: parseFloat(style.paddingLeft) || 0,
      mainAxisAlignment: this.mapJustifyContent(justifyContent),
      crossAxisAlignment: this.mapAlignItems(alignItems),
      wrap: flexWrap === 'wrap' || flexWrap === 'wrap-reverse',
    };
  }

  extractConstraints(style: CSSStyleDeclaration, element: Element): W2FConstraints {
    const position = style.position;

    let horizontal: W2FConstraints['horizontal'] = 'MIN';
    let vertical: W2FConstraints['vertical'] = 'MIN';

    if (position === 'fixed' || position === 'absolute') {
      const hasLeft = style.left !== 'auto';
      const hasRight = style.right !== 'auto';
      const hasTop = style.top !== 'auto';
      const hasBottom = style.bottom !== 'auto';

      if (hasLeft && hasRight) horizontal = 'STRETCH';
      else if (hasRight) horizontal = 'MAX';
      else if (hasLeft) horizontal = 'MIN';

      if (hasTop && hasBottom) vertical = 'STRETCH';
      else if (hasBottom) vertical = 'MAX';
      else if (hasTop) vertical = 'MIN';
    }

    // Check for width: 100% or similar stretch indicators
    if (style.width === '100%') horizontal = 'STRETCH';
    if (style.height === '100%') vertical = 'STRETCH';

    // Check margin auto for centering
    if (style.marginLeft === 'auto' && style.marginRight === 'auto') {
      horizontal = 'CENTER';
    }

    return { horizontal, vertical };
  }

  private extractGap(style: CSSStyleDeclaration): number {
    // gap property (works for both flex and grid)
    const gap = style.gap || style.getPropertyValue('gap');
    if (gap && gap !== 'normal') {
      const parsed = parseFloat(gap);
      if (!isNaN(parsed)) return parsed;
    }

    // row-gap / column-gap
    const rowGap = parseFloat(style.rowGap) || 0;
    const colGap = parseFloat(style.columnGap) || 0;

    return Math.max(rowGap, colGap);
  }

  private mapJustifyContent(value: string): W2FAutoLayout['mainAxisAlignment'] {
    switch (value) {
      case 'flex-start':
      case 'start':
        return 'MIN';
      case 'center':
        return 'CENTER';
      case 'flex-end':
      case 'end':
        return 'MAX';
      case 'space-between':
        return 'SPACE_BETWEEN';
      default:
        return 'MIN';
    }
  }

  private mapAlignItems(value: string): W2FAutoLayout['crossAxisAlignment'] {
    switch (value) {
      case 'flex-start':
      case 'start':
        return 'MIN';
      case 'center':
        return 'CENTER';
      case 'flex-end':
      case 'end':
        return 'MAX';
      case 'stretch':
        return 'STRETCH';
      default:
        return 'MIN';
    }
  }
}
