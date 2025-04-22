#include "hashing.h"

#include <vector>

namespace dolos {
    uint64_t tokenHash(char *tok) {
        uint64_t h = 0;
        while (char c = *tok++) {
            h = (h + c) * 747287 % mod;
        }
        return h;
    }

    uint64_t RollingHash::operator()(const uint64_t tok) {
        hash = (base * hash + tok + max_base * memory[i]) % mod;
        memory[i] = tok;
        i = ++i % k;
        return hash;
    }
}
