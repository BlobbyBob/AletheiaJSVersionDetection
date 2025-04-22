#ifndef INDEX_H
#define INDEX_H

#include <set>
#include <span>
#include <string>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "tokenizer.h"

namespace dolos {
    struct Pair {
        std::string left, right;
        uint32_t covered;
        uint32_t leftTotal, rightTotal;
    };

    struct Index {
        std::unordered_map<uint64_t, std::set<uint16_t>> index;
        std::unordered_map<uint16_t, std::set<uint64_t>> groups;
        std::unordered_map<std::string, uint16_t> identifiers;
        std::unordered_map<uint16_t, std::string> names;
        uint16_t k, w;

        explicit Index(const std::string &serialization);

        explicit Index(const uint16_t k, const uint16_t w) : k(k), w(w) {
        }

        void addToGroup(const std::string &groupName, std::span<const char> sourceCode);

        Pair getPair(const std::string &a, const std::string &b);

        std::vector<Pair> matchExternal(std::span<const char> sourceCode) const;

        std::vector<Pair> matchTokens(const TokenizedFile &tokens) const;

        std::string serialize() const;
    };
}

#endif //INDEX_H
