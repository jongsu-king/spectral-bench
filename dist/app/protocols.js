export const protocols = {
  array: {
    steps: [
      'Select Three-line source and center the grating so that at least two reference lines reach the CCD.',
      'Click Calibrate wavelength. Inspect the reference peaks on the pixel axis before reading the wavelength axis.',
      'Select Close doublet and click Acquire sample. Repeat with a wider entrance slit while holding the grating settings fixed.',
      'Adjust the grating rotation or groove density and watch the detector spots move. Recalibrate before reporting peak wavelengths.',
    ],
    observation: 'A wider slit admits more light and broadens the line images. Grating adjustments move the peaks across the CCD and change the pixel-to-wavelength calibration.',
  },
  uv: {
    steps: [
      'Select Transmission, set the cuvette path length, and select Matched solvent. Click Dark to record the blocked-detector baseline.',
      'Click Acquire blank, then Acquire sample at the same bandwidth and alignment. Compare the raw counts and absorbance.',
      'Halve the concentration and reacquire the sample. Then try a mismatched blank or increase stray light to see how the baseline and strong bands change.',
      'Switch to Reflectance and acquire the white standard. Acquire the sample with specular reflection included and again with it excluded.',
    ],
    observation: 'With a matched blank and little stray light, absorbance near 405 nm scales with concentration and path length. Including the specular component raises the modeled sphere reflectance.',
  },
  pl: {
    steps: [
      'Set excitation to 405 nm and enable the excitation rejection filter. Inspect the perpendicular collection path from the sample to the detector.',
      'Set the emission bandwidth and integration time. Click Acquire blank and then Acquire sample at the same settings.',
      'Move excitation away from the absorption band and repeat the blank and sample scans. Compare the corrected emission band.',
      'Disable the rejection filter and inspect the raw detector signal near the excitation wavelength. Restore the filter and reacquire the blank before continuing.',
    ],
    observation: 'The simulated dye emits near 520 nm when excited in its absorption band. Light leaking through the excitation path produces a narrow peak near the excitation wavelength in the raw scan.',
  },
  trpl: {
    steps: [
      'Set excitation to 405 nm, detection to 520 nm, and the laser repetition rate to 20 MHz. Begin with a low photon flux.',
      'Click Acquire IRF to record the prompt scattering response. Click Acquire sample with the same timing settings and review the photon histogram.',
      'Compare the reconvolution fit and its residuals. Use Replay photons to inspect how laser-to-photon delays populate the histogram.',
      'Raise the photon flux and reacquire. Increase neutral-density attenuation until the per-pulse detection probability falls and the fitted lifetime recovers.',
    ],
    observation: 'The default synthetic lifetime is 4 ns. High detection probability favors the earliest detected photon in each pulse period and can bias the fitted lifetime downward.',
  },
  raman: {
    steps: [
      'Set axial focus near zero and enable the Rayleigh rejection filter. Select 532 nm and click Acquire Si standard.',
      'Check the silicon band near 520.7 cm⁻¹, then select a sample and click Acquire sample.',
      'Change the laser wavelength, repeat the reference check, and reacquire the same sample. Compare the wavelength and Raman-shift plots.',
      'Offset the focus to reduce collection. Toggle Rayleigh rejection briefly to inspect the elastic scattering near zero Raman shift.',
    ],
    observation: 'Changing the laser moves a given Raman band on the detected-wavelength axis while its Raman shift stays fixed. Defocus reduces collection and removing the filter exposes the Rayleigh peak.',
  },
  ftir: {
    steps: [
      'Select Transmission and set the mirror scan range. Click Acquire background with the modeled sample removed from the beam.',
      'Select Polystyrene or PET and click Acquire sample. Compare the centerburst in the Michelson interferogram with the bands in the background-corrected spectrum.',
      'Change the mirror scan range and repeat both scans. The optical path difference changes by twice the mirror displacement.',
      'Select ATR and acquire a fresh background for the empty crystal. Repeat the sample scan at high and low crystal contact fractions.',
    ],
    observation: 'A longer optical path scan resolves narrower features. The ATR absorbance bands weaken as the modeled contact with the diamond crystal decreases.',
  },
  ellipsometry: {
    steps: [
      'Set a nominal incidence angle near 65° and inspect the reflected beam path through the analyzer.',
      'Click Acquire substrate to record the bare silicon signal. Set the SiO₂ film thickness and click Acquire sample.',
      'Compare Ψ and Δ across the three incidence angles. Read the fitted thickness from the known SiO₂/Si material model.',
      'Change the analyzer angle and reacquire. Compare the detector intensity and the fitted result from the modeled polarization channels.',
    ],
    observation: 'The analyzer angle changes raw detector intensity. Fitting the idealized polarization channels recovers the synthetic film thickness with the optical constants held fixed.',
  },
  ta: {
    steps: [
      'Bring the pump and probe spots together by setting the beam offset near zero. Set a moderate pump fluence and a short positive delay.',
      'Click Acquire pump off to record the transmitted probe baseline. Enable the pump and click Acquire sample.',
      'Move the delay stage through time zero. Compare the wavelength slice at the current delay with the wavelength–delay map.',
      'Displace the pump spot or turn the pump off and repeat the scan. Compare the pump-on and pump-off traces at the same delay.',
    ],
    observation: 'The synthetic response includes ground-state bleaching near 521 nm and excited-state absorption near 646 nm. The differential signal approaches zero with the pump off or the beams separated.',
  },
  thz: {
    steps: [
      'Align the parabolic mirrors and choose the acquisition time window. Click Acquire air reference with the sample absent at the current humidity.',
      'Use the default 1.00 mm, n = 1.50 slab and click Acquire sample. Move the delay stage to inspect the signed electric field at different times.',
      'Compare the field amplitude ratio and unwrapped phase. Inspect the retrieved refractive index and absorption over the supported frequency range.',
      'Change humidity after recording the reference and repeat the sample scan. Acquire a new air reference at the same humidity to isolate the slab response.',
    ],
    observation: 'The default slab delays the primary pulse by about 1.67 ps. With internal reflections enabled, its first echo follows about 10.01 ps later. The slab model assumes normal incidence and known thickness.',
  },
};
