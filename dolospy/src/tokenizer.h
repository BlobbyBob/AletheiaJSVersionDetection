#ifndef TOKENIZER_H
#define TOKENIZER_H

#include <span>
#include <vector>
#include <cstdint>


namespace dolos {
    typedef std::vector<uint16_t> TokenizedFile;
    TokenizedFile tokenize(std::span<const char> buffer);
}

#endif //TOKENIZER_H
