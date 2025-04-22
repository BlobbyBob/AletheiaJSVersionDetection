#ifndef HASHING_H
#define HASHING_H

#include <algorithm>
#include <cstdint>
#include <limits>
#include <optional>
#include <vector>

namespace dolos {
    static constexpr uint64_t mod = 33554393;

    template <typename T>
    T modPow(const T base, const T exp, const T mod) {
        T y = 1;
        T b = base;
        T e = exp;

        while (e > 1) {
            if (e & 1) {
                y = b * y % mod;
            }
            b = b * b % mod;
            e >>= 1;
        }

        return b * y % mod;
    }

    uint64_t tokenHash(char *tok);

    struct RollingHash {
        static constexpr uint64_t base = 4194301;
        uint64_t k;
        uint64_t max_base;
        uint64_t hash = 0;
        uint64_t i = 0;
        std::vector<uint64_t> memory;

        explicit RollingHash(const uint64_t k) : k(k), max_base(mod - modPow(base, k, mod)), memory(k, 0) {
        }

        uint64_t operator()(uint64_t tok);
    };

    class RollingHashIterator {
        std::vector<uint16_t>::const_iterator it;
        RollingHash hash;

    public:
        using value_type = uint64_t;
        using difference_type = std::ptrdiff_t;
        using iterator_category = std::input_iterator_tag;

        explicit RollingHashIterator(const uint32_t k,
                                     const std::vector<uint16_t>::const_iterator it) : hash(k), it(it) {
        }

        uint64_t operator*() { return hash(*it); } // Is not const !
        RollingHashIterator &operator++() {
            ++it;
            return *this;
        }

        bool operator!=(const RollingHashIterator &other) const { return it != other.it; }
    };

    template<typename Iter>
    std::vector<uint64_t> winnowFilter(const uint32_t w, Iter begin, Iter end,
                                       const std::optional<uint32_t> sizeEstimation = std::nullopt) {
        // Algorithm from http://theory.stanford.edu/~aiken/publications/papers/sigmod03.pdf page 9
        std::vector<uint64_t> filtered;
        filtered.reserve(sizeEstimation == std::nullopt ? 0 : sizeEstimation.value());

        std::vector h(w, std::numeric_limits<uint64_t>::max());

        uint64_t r = 0;
        uint64_t min = 0;

        for (auto it = begin; it != end; ++it) {
            r = ++r % w;
            h[r] = *it;
            if (min == r) {
                min = std::distance(std::begin(h), std::ranges::min_element(h));
                filtered.emplace_back(h[min]);
            } else {
                if (h[min] < h[r]) {
                    min = r;
                    filtered.emplace_back(h[min]);
                }
            }
        }

        return filtered;
    };
}

#endif //HASHING_H
