#include <math.h>
#include <stddef.h>

#if defined(_WIN32)
#define SPECTRAL_EXPORT __declspec(dllexport)
#else
#define SPECTRAL_EXPORT __attribute__((visibility("default")))
#endif

/* In-place radix-2 transform using the same sign convention as the UI model. */
SPECTRAL_EXPORT int sb_fft(double *real, double *imag, size_t count, int inverse)
{
    if (!real || !imag || count == 0 || count > 65536 || (count & (count - 1))) {
        return -1;
    }

    for (size_t index = 1, reversed = 0; index < count; ++index) {
        size_t bit = count >> 1;
        while (reversed & bit) {
            reversed ^= bit;
            bit >>= 1;
        }
        reversed ^= bit;
        if (index < reversed) {
            double real_value = real[index];
            double imag_value = imag[index];
            real[index] = real[reversed];
            imag[index] = imag[reversed];
            real[reversed] = real_value;
            imag[reversed] = imag_value;
        }
    }

    const double two_pi = 6.283185307179586476925286766559;
    for (size_t length = 2; length <= count; length *= 2) {
        size_t half = length / 2;
        double angle = (inverse ? two_pi : -two_pi) / (double)length;
        double step_real = cos(angle);
        double step_imag = sin(angle);

        for (size_t start = 0; start < count; start += length) {
            double twiddle_real = 1.0;
            double twiddle_imag = 0.0;
            for (size_t offset = 0; offset < half; ++offset) {
                size_t upper = start + offset;
                size_t lower = upper + half;
                double lower_real = real[lower] * twiddle_real - imag[lower] * twiddle_imag;
                double lower_imag = real[lower] * twiddle_imag + imag[lower] * twiddle_real;
                real[lower] = real[upper] - lower_real;
                imag[lower] = imag[upper] - lower_imag;
                real[upper] += lower_real;
                imag[upper] += lower_imag;

                double next_real = twiddle_real * step_real - twiddle_imag * step_imag;
                twiddle_imag = twiddle_real * step_imag + twiddle_imag * step_real;
                twiddle_real = next_real;
            }
        }
    }

    if (inverse) {
        for (size_t index = 0; index < count; ++index) {
            real[index] /= (double)count;
            imag[index] /= (double)count;
        }
    }
    return 0;
}
