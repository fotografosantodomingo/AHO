import { describe, it, expect } from 'vitest';
import { buildPhotoAlt, buildPhotoCaption } from '@/lib/listings/photo-seo';

const baseEn = {
  title: 'Modern Villa',
  transactionType: 'sale' as const,
  propertyType: 'villa',
  city: 'Santo Domingo',
  countryDisplay: 'Dominican Republic',
  locale: 'en' as const,
};

const baseEs = { ...baseEn, locale: 'es' as const };

describe('buildPhotoAlt', () => {
  it('combines title + property type + transaction phrase + location (en)', () => {
    expect(buildPhotoAlt(baseEn)).toBe(
      'Modern Villa — villa for sale in Santo Domingo, Dominican Republic',
    );
  });

  it('translates the transaction phrase to Spanish', () => {
    expect(buildPhotoAlt(baseEs)).toBe(
      'Villa Moderna — villa en venta en Santo Domingo, República Dominicana'.replace(
        'Villa Moderna',
        'Modern Villa',
      ).replace('República Dominicana', 'Dominican Republic'),
    );
    // Same with the actual ES title + country display:
    expect(
      buildPhotoAlt({
        ...baseEs,
        title: 'Villa Moderna',
        countryDisplay: 'República Dominicana',
      }),
    ).toBe(
      'Villa Moderna — villa en venta en Santo Domingo, República Dominicana',
    );
  });

  it('uses "for rent" / "en alquiler" for rent listings', () => {
    expect(buildPhotoAlt({ ...baseEn, transactionType: 'rent' })).toContain(
      'for rent',
    );
    expect(buildPhotoAlt({ ...baseEs, transactionType: 'rent' })).toContain(
      'en alquiler',
    );
  });

  it('uses "short-term rental" / "alquiler temporal" for short_term', () => {
    expect(buildPhotoAlt({ ...baseEn, transactionType: 'short_term' })).toContain(
      'short-term rental',
    );
    expect(buildPhotoAlt({ ...baseEs, transactionType: 'short_term' })).toContain(
      'alquiler temporal',
    );
  });

  it('translates common property types to Spanish', () => {
    expect(buildPhotoAlt({ ...baseEs, propertyType: 'apartment' })).toContain(
      'apartamento',
    );
    expect(buildPhotoAlt({ ...baseEs, propertyType: 'house' })).toContain('casa');
    expect(buildPhotoAlt({ ...baseEs, propertyType: 'land' })).toContain('terreno');
  });

  it('falls through unrecognized property types unchanged', () => {
    expect(buildPhotoAlt({ ...baseEn, propertyType: 'farmhouse' })).toContain(
      'farmhouse',
    );
  });

  it('appends "Photo X of Y" when total > 1 and position is given', () => {
    const result = buildPhotoAlt({ ...baseEn, position: 2, total: 8 });
    expect(result).toMatch(/\(Photo 2 of 8\)$/);
  });

  it('uses "Foto X de Y" in Spanish', () => {
    const result = buildPhotoAlt({
      ...baseEs,
      title: 'Villa Moderna',
      countryDisplay: 'República Dominicana',
      position: 3,
      total: 5,
    });
    expect(result).toMatch(/\(Foto 3 de 5\)$/);
  });

  it('omits the photo-N-of-M suffix when total is 1', () => {
    expect(buildPhotoAlt({ ...baseEn, position: 1, total: 1 })).not.toContain(
      'Photo',
    );
  });

  it('omits the photo-N-of-M suffix when position or total are missing', () => {
    expect(buildPhotoAlt(baseEn)).not.toContain('Photo');
    expect(buildPhotoAlt({ ...baseEn, position: 2 })).not.toContain('Photo');
  });
});

describe('upload-flow integration shape (buildPhotoAlt as the single source)', () => {
  // These tests pin the EXACT string a photo gets stored with at
  // upload time. They're here because the three upload paths
  // (image-uploader.tsx, listing-form.tsx, /api/properties/[id]/
  // import-photos/route.ts) all call buildPhotoAlt with the same
  // contract — and that contract is what survives in the DB and feeds
  // image-sitemap.xml, the RealEstateListing JSON-LD ImageObject.caption,
  // and the property-gallery render. If the string format changes
  // here, the SEO-side downstream auto-tracks.

  it('apartment for rent in Warsaw — EN + ES alt strings', () => {
    const en = buildPhotoAlt({
      title: 'Mokotów loft',
      transactionType: 'rent',
      propertyType: 'apartment',
      city: 'Warsaw',
      countryDisplay: 'Poland',
      position: 2,
      total: 5,
      locale: 'en',
    });
    const es = buildPhotoAlt({
      title: 'Mokotów loft',
      transactionType: 'rent',
      propertyType: 'apartment',
      city: 'Warsaw',
      countryDisplay: 'Polonia',
      position: 2,
      total: 5,
      locale: 'es',
    });
    expect(en).toBe(
      'Mokotów loft — apartment for rent in Warsaw, Poland (Photo 2 of 5)',
    );
    expect(es).toBe(
      'Mokotów loft — apartamento en alquiler en Warsaw, Polonia (Foto 2 de 5)',
    );
  });

  it('short-term rental villa — sale phrase replaced correctly', () => {
    const en = buildPhotoAlt({
      title: 'Punta Cana getaway',
      transactionType: 'short_term',
      propertyType: 'villa',
      city: 'Punta Cana',
      countryDisplay: 'Dominican Republic',
      locale: 'en',
    });
    expect(en).toContain('villa short-term rental');
    expect(en).not.toContain('for sale');
    expect(en).not.toContain('for rent');
  });

  it('import-photos batch tail — total reflects the WHOLE listing, not the current batch slot', () => {
    // The route computes `totalAfterBatch = startCount + dedup.length`,
    // so an import of 4 URLs onto a listing that already has 6 photos
    // produces "Photo 7 of 10" through "Photo 10 of 10".
    const startCount = 6;
    const importing = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
    const totalAfterBatch = startCount + importing.length;
    const alts = importing.map((_, index) =>
      buildPhotoAlt({
        title: 'Modern Villa',
        transactionType: 'sale',
        propertyType: 'villa',
        city: 'Santo Domingo',
        countryDisplay: 'Dominican Republic',
        position: startCount + index + 1,
        total: totalAfterBatch,
        locale: 'en',
      }),
    );
    expect(alts).toEqual([
      'Modern Villa — villa for sale in Santo Domingo, Dominican Republic (Photo 7 of 10)',
      'Modern Villa — villa for sale in Santo Domingo, Dominican Republic (Photo 8 of 10)',
      'Modern Villa — villa for sale in Santo Domingo, Dominican Republic (Photo 9 of 10)',
      'Modern Villa — villa for sale in Santo Domingo, Dominican Republic (Photo 10 of 10)',
    ]);
  });
});

describe('buildPhotoCaption', () => {
  it('sentence-cases the property type', () => {
    expect(buildPhotoCaption(baseEn)).toBe(
      'Modern Villa — Villa for sale in Santo Domingo, Dominican Republic',
    );
  });

  it('omits the photo-N-of-M suffix even if present in the args (TS strips it via Omit)', () => {
    expect(buildPhotoCaption(baseEn)).not.toContain('Photo');
  });

  it('handles Spanish translations + sentence-case', () => {
    expect(
      buildPhotoCaption({
        ...baseEs,
        title: 'Villa Moderna',
        countryDisplay: 'República Dominicana',
        propertyType: 'apartment',
      }),
    ).toBe(
      'Villa Moderna — Apartamento en venta en Santo Domingo, República Dominicana',
    );
  });
});
