#ifndef INTERFACE_H
#define INTERFACE_H

#include <string>
#include <vector>

std::vector<char> readFile(const std::string &name);

void compareFiles(const char *f1, const char *f2);

int magic = 42;

#endif //INTERFACE_H
