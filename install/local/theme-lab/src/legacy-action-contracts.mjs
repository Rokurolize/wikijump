import crypto from 'node:crypto';

// These serialization shapes are frozen in browser-action-contract-formats/.
// Only unused null fields may disappear. A required helper may never be
// inferred from a legacy contract which did not bind its implementation.
export function legacyEquivalentContractHashes(contract) {
  const variants = [contract];
  const shapes = [['renderedSubmenuGeometry'],
    ['expandMobileTopSubmenu', 'expandTabletTopNavigation', 'navigationActivation', 'renderedSubmenuGeometry']];
  for (const absent of shapes) {
    if (!absent.every(key => contract[key] === null)) continue;
    const variant = {...contract};
    for (const key of absent) delete variant[key];
    variants.push(variant);
  }
  return [...new Set(variants.map(value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')))];
}
