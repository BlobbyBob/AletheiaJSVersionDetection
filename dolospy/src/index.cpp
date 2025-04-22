#include "index.h"

#include <algorithm>
#include <vector>

#include <boost/json/src.hpp>

#include "hashing.h"
#include "tokenizer.h"

namespace json = boost::json;

namespace dolos {
    void Index::addToGroup(const std::string &groupName, const std::span<const char> sourceCode) {
        const auto it = identifiers.find(groupName);
        uint16_t identifier;
        if (it == identifiers.end()) {
            identifier = identifiers.size();
            identifiers[groupName] = identifier;
            names[identifier] = groupName;
        } else {
            identifier = it->second;
        }

        std::vector<uint16_t> tokens = tokenize(sourceCode);

        auto begin = RollingHashIterator(k, tokens.begin());
        const auto end = RollingHashIterator(k, tokens.end());

        for (const auto hashes = winnowFilter(w, begin, end, std::optional<uint32_t>(tokens.size() / w + 1));
             const auto &hash: hashes) {
            index[hash].insert(identifier);
            groups[identifier].insert(hash);
        }
    }

    Pair Index::getPair(const std::string &a, const std::string &b) {
        auto x = identifiers[a];
        auto y = identifiers[b];
        auto A = groups[x];
        auto B = groups[y];
        std::vector<uint64_t> unused{};
        std::ranges::set_intersection(A, B, std::back_inserter(unused));
        const uint32_t intersectionSize = unused.size();

        return {
            .left = a,
            .right = b,
            .covered = intersectionSize,
            .leftTotal = static_cast<uint32_t>(A.size()),
            .rightTotal = static_cast<uint32_t>(B.size()),
        };
    }

    std::vector<Pair> Index::matchExternal(const std::span<const char> sourceCode) const {
        const std::vector<uint16_t> tokens = tokenize(sourceCode);
        return matchTokens(tokens);
    }

    std::vector<Pair> Index::matchTokens(const TokenizedFile &tokens) const {
        std::vector<Pair> pairs;
        const std::string external = "external";

        auto begin = RollingHashIterator(k, tokens.begin());
        const auto end = RollingHashIterator(k, tokens.end());

        std::unordered_map<uint16_t, uint32_t> sharedHashes;
        uint32_t total = 0;

        // We want to return results for all entries
        for (const auto& [_, id] : identifiers) {
            sharedHashes[id] = 0;
        }

        for (const auto hashes = winnowFilter(w, begin, end, std::optional<uint32_t>(tokens.size() / w + 1));
             const auto &hash: hashes) {
            total += 1;
            if (const auto it = index.find(hash); it != index.end()) {
                for (const auto identifier: it->second) {
                    sharedHashes[identifier] += 1;
                }
            }
        }

        pairs.reserve(sharedHashes.size());
        for (auto [identifier, count]: sharedHashes) {
            pairs.emplace_back(Pair{
                .left = external,
                .right = names.at(identifier),
                .covered = count,
                .leftTotal = total,
                .rightTotal = groups.contains(identifier) ? static_cast<uint32_t>(groups.at(identifier).size()) : 0,
            });
        }

        return pairs;
    }

    std::string Index::serialize() const {
        json::array sIdentifiers;
        sIdentifiers.reserve(identifiers.size());
        for (const auto &[name, id]: identifiers) {
            sIdentifiers.emplace_back(json::array({name, id}));
        }

        json::array sIndex;
        sIndex.reserve(index.size());
        for (const auto& [hash, ids]: index) {
            json::array sIds(ids.begin(), ids.end());
            sIndex.emplace_back(json::array({hash, sIds}));
        }

        json::object s;
        s["k"] = k;
        s["w"] = w;
        s["index"] = sIndex;
        s["identifiers"] = sIdentifiers;

        return json::serialize(s);
    }

    Index::Index(const std::string &serialization) {
        const json::object s = json::parse(serialization).as_object();
        k = s.at("k").as_int64();
        w = s.at("w").as_int64();
        for (const auto sIdentifiers = s.at("identifiers").as_array(); const auto& tmp: sIdentifiers) {
            const auto arr = tmp.as_array();
            const auto name = arr[0].as_string();
            const auto id = static_cast<uint16_t>(arr[1].as_int64());
            identifiers[std::string(name)] = id;
            names[id] = name;
        }

        for (const auto sIndex = s.at("index").as_array(); const auto& tmp: sIndex) {
            const auto arr = tmp.as_array();
            const auto hash = static_cast<uint32_t>(arr[0].as_int64());
            for (const auto sIds = arr[1].as_array(); const auto& tmp2: sIds) {
                const auto id = static_cast<uint16_t>(tmp2.as_int64());
                index[hash].insert(id);
                groups[id].insert(hash);
            }
        }
    }
}
