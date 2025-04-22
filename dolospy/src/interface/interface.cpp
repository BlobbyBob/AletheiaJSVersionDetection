#include "interface.h"

#include <fstream>
#include <iostream>
#include <span>
#include <vector>

#include "../index.h"

std::vector<char> readFile(const std::string &name) {
    std::ifstream file(name);
    file.seekg(0, std::ios::end);
    const long file_size = file.tellg();
    file.seekg(0, std::ios::beg);
    if (!file.is_open()) {
        std::cerr << "Failed to open file " << name << std::endl;
        throw std::runtime_error("Failed to open file");
    }

    std::vector<char> buffer(file_size);
    file.read(buffer.data(), file_size);
    file.close();

    std::cout << name << " (size " << file_size << ")" << std::endl;

    return buffer;
}

void compareFiles(const char *f1, const char *f2) {
    auto file1 = readFile(f1);
    auto file2 = readFile(f2);

    dolos::Index index(17, 23);

    index.addToGroup(f1, std::span{file1});
    index.addToGroup(f2, std::span{file2});

    const auto pair = index.getPair(f1, f2);

    std::cout << "Left: " << pair.left << "  Right: " << pair.right << std::endl;
    std::cout << "Covered: " << pair.covered << std::endl;
    std::cout << "Total: " << pair.leftTotal << "/" << pair.rightTotal << std::endl;
}
