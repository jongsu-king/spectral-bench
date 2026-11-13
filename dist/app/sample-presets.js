const coumarinSource = {
  title: 'Coumarin 6 photophysics in ethanol and micelles, Table 1',
  url: 'https://www.mdpi.com/1420-3049/20/10/19343',
};
const fluoresceinSource = {
  title: 'PhotochemCAD measured fluorescein spectra in ethanol',
  url: 'https://www.omlc.org/spectra/PhotochemCAD/html/010.html',
};
const oxideSource = {
  title: 'NIST Thin Film Reference Materials Development, SRM 2530 series',
  url: 'https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication400-100.pdf',
};

// Bands are center, standard deviation, and relative amplitude. Only the
// measured peak positions anchor these simplified spectral profiles.
const coumarin = {
  absorptionBands: [[457, 23, 0.78]],
  emissionBands: [[501, 18, 1]],
};
const fluorescein = {
  absorptionBands: [[482.5, 22, 0.84]],
  emissionBands: [[515.5, 23, 1]],
};

export const samplePresets = {
  array: [
    {
      id: 'mercury-lamp',
      label: 'Mercury discharge lamp',
      settings: { source: 'triple' },
      profile: { sourceType: 'triple', sourceLines: [[404.6563, 0.4], [435.8328, 1], [546.0735, 0.5]] },
      note: 'Three Hg I air wavelengths from the NIST table. Source powers are relative.',
      source: {
        title: 'NIST Atomic Spectra Handbook, strong lines of mercury',
        url: 'https://physics.nist.gov/PhysRefData/Handbook/Tables/mercurytable2.htm',
      },
    },
    {
      id: 'sodium-lamp',
      label: 'Sodium D doublet',
      settings: { source: 'doublet', slit: 30 },
      profile: { sourceType: 'doublet', sourceLines: [[588.995, 1], [589.5924, 0.5]] },
      note: 'Na I D lines at 588.995 and 589.5924 nm in air. Use the slit to test whether the pair can be resolved.',
      source: {
        title: 'NIST Atomic Spectra Handbook, strong lines of sodium',
        url: 'https://physics.nist.gov/PhysRefData/Handbook/Tables/sodiumtable2_a.htm',
      },
    },
  ],
  uv: [
    {
      id: 'coumarin-6',
      label: 'Coumarin 6 in ethanol',
      settings: { mode: 'transmission', concentration: 1, pathLength: 1, blank: 'matched' },
      profile: coumarin,
      note: 'The measured absorption maximum is 457 nm at 25 °C. The Gaussian width and concentration scale are simulation parameters.',
      source: coumarinSource,
    },
    {
      id: 'fluorescein',
      label: 'Fluorescein in ethanol',
      settings: { mode: 'transmission', concentration: 1, pathLength: 1, blank: 'matched' },
      profile: fluorescein,
      note: 'PhotochemCAD scales the measured extinction spectrum at 482.5 nm. The Gaussian width and concentration scale are simulation parameters.',
      source: fluoresceinSource,
    },
  ],
  pl: [
    {
      id: 'coumarin-6',
      label: 'Coumarin 6 in ethanol',
      settings: { excitation: 465, concentration: 1, filter: true },
      profile: coumarin,
      note: 'The measured emission maximum is 501 nm at 25 °C under 465 nm excitation. The Gaussian width and photon count scale are simulated.',
      source: coumarinSource,
    },
    {
      id: 'fluorescein',
      label: 'Fluorescein in ethanol',
      settings: { excitation: 482, concentration: 1, filter: true },
      profile: fluorescein,
      note: 'The PhotochemCAD emission data peak at about 516 nm. The excitation setting, Gaussian width and count scale are chosen for the simulation.',
      source: fluoresceinSource,
    },
  ],
  trpl: [
    {
      id: 'coumarin-6',
      label: 'Coumarin 6 in ethanol',
      settings: { excitation: 457, detection: 501, lifetime: 2.6 },
      profile: coumarin,
      note: 'The measured single-exponential lifetime is 2.57 ns at 25 °C. The simulated lifetime is rounded to the 0.1 ns setting step.',
      source: coumarinSource,
    },
    {
      id: 'fluorescein',
      label: 'Fluorescein in ethanol',
      settings: { excitation: 482, detection: 516, lifetime: 3.6 },
      profile: fluorescein,
      note: 'The measured lifetime in ethanol is about 3.6 ns. Excitation and detection settings use separate PhotochemCAD spectral anchors.',
      source: {
        title: 'Testing Fluorescence Lifetime Standards, fluorescein solvent measurements',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6153725/',
      },
    },
  ],
  raman: [
    {
      id: 'silicon-wafer',
      label: 'Silicon wafer',
      settings: { sample: 'silicon', laser: '532', focus: 0, filter: true },
      note: 'The model uses 520.7 cm⁻¹ for the principal silicon Raman band. Bandwidths and subsidiary bands are simplified.',
      source: {
        title: 'Certified silicon Raman shift standard GBW(E)130752',
        url: 'https://www.ncrm.org.cn/Web/Ordering/MaterialDetail?autoID=27880',
      },
    },
    {
      id: 'polystyrene',
      label: 'Polystyrene',
      settings: { sample: 'polymer', laser: '532', focus: 0, filter: true },
      note: 'The prominent polystyrene band is near 1001.4 cm⁻¹. The simulated spectrum uses selected bands and relative intensities.',
      source: {
        title: 'Experimental comparison of Raman shifts from 26 systems',
        url: 'https://www.jstage.jst.go.jp/article/analsci/35/5/35_18P501/_article/-char/en',
      },
    },
  ],
  ftir: [
    {
      id: 'polystyrene-film',
      label: 'Polystyrene film',
      settings: { material: 'polystyrene', mode: 'transmission' },
      note: 'NIST SRM 1921 uses a polystyrene film for wavenumber calibration. The model includes selected bands near 1028, 1601 and 3026 cm⁻¹.',
      source: {
        title: 'NIST SRM 1921 polystyrene film for infrared wavenumber calibration',
        url: 'https://www.nist.gov/publications/standard-reference-materials-polystyrene-films-calibrating-wavelength-scale-infrared',
      },
    },
    {
      id: 'pet-film',
      label: 'PET film, ATR',
      settings: { material: 'pet', mode: 'atr', contact: 90 },
      note: 'Published PET spectra show ester bands near 1715, 1240 and 1090 cm⁻¹. The model approximates their positions and shapes.',
      source: {
        title: 'Experimental FTIR of PET and PETG, virgin-material spectra',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13269881/',
      },
    },
  ],
  ellipsometry: [
    {
      id: 'oxide-50',
      label: 'SiO₂ on silicon, 50 nm',
      settings: { thickness: 50, incidenceAngle: 65 },
      note: 'NIST SRM 2530-01 provides the nominal 50 nm thickness example. The model uses approximate optical constants.',
      source: oxideSource,
    },
    {
      id: 'oxide-200',
      label: 'SiO₂ on silicon, 200 nm',
      settings: { thickness: 200, incidenceAngle: 65 },
      note: 'NIST SRM 2530-03 provides the nominal 200 nm thickness example. The model uses approximate optical constants.',
      source: oxideSource,
    },
  ],
  ta: [
    {
      id: 'cspbbr3-film',
      label: 'CsPbBr₃ thin film',
      settings: { pump: true, fluence: 15, delay: 0.8, offset: 0 },
      profile: { transientBands: [[520, 9, -0.022, 24], [530, 10, 0.013, 0.65], [475, 20, 0.009, 10]] },
      note: 'The measured features include a 520 nm bleach, a short-lived 530 nm positive band, and a broad 460–490 nm positive band. Widths, amplitudes and decays are approximate.',
      source: {
        title: 'Femtosecond transient absorption of CsPbBr₃ thin films, Fig. 4',
        url: 'https://pubs.rsc.org/en/content/articlehtml/2023/ta/d2ta09920a',
      },
    },
    {
      id: 'cdse-qd',
      label: 'CdSe quantum dots, 618 nm band edge',
      settings: { pump: true, fluence: 15, delay: 0.8, offset: 0 },
      profile: { transientBands: [[618, 10, -0.024, 26], [589, 10, -0.012, 13], [650, 16, 0.011, 6]] },
      note: 'The reported quantum-dot spectrum includes bleaches near 618 and 589 nm and photoinduced absorption near 650 nm. Widths, amplitudes and decays are approximate.',
      source: {
        title: 'CdSe quantum-dot transient absorption, Nature Communications 12, 550',
        url: 'https://www.nature.com/articles/s41467-020-20835-4',
      },
    },
  ],
  thz: [
    {
      id: 'hdpe',
      label: 'HDPE slab',
      settings: { index: 1.53, absorption: 0.5, thickness: 1 },
      note: 'Experimental THz-TDS gives n ≈ 1.53 for HDPE. Slab thickness and frequency-independent loss are simulation settings.',
      source: {
        title: 'THz-TDS measurements of HDPE, polyamide and liquid-crystal polymer, Fig. 5',
        url: 'https://www.toptica.com/fileadmin/Editors_English/12_literature/03_terahertz/toptica_terahertz-time_domain_spectrometer_with_90_dB_peak_dynamic_range.pdf',
      },
    },
    {
      id: 'fused-silica',
      label: 'Fused silica slab',
      settings: { index: 1.95, absorption: 1, thickness: 1 },
      note: 'The reported index is 1.952 at 0.5 THz. The simulated slab has constant index and loss across frequency.',
      source: {
        title: 'Wideband dielectric properties of silicon and glass substrates, Tables 1–2',
        url: 'https://eprints.whiterose.ac.uk/id/eprint/172709/7/Chudpooti_2021_Mater._Res._Express_8_056201.pdf',
      },
    },
  ],
};
