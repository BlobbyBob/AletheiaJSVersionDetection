cmake_minimum_required(VERSION 3.25)
project(dolos)

set(CMAKE_CXX_STANDARD 23)

file(GLOB SRC_FILES src/*.cpp)

add_executable(dolos main.cpp ${SRC_FILES})
target_link_libraries(dolos tree-sitter tree-sitter-javascript)

add_library(doloslib SHARED src/interface/interface.cpp ${SRC_FILES})
target_link_libraries(doloslib tree-sitter tree-sitter-javascript)

set(PYBIND11_FINDPYTHON ON)
find_package(pybind11 REQUIRED)

pybind11_add_module(dolospy SHARED src/interface/python.cpp)
target_link_libraries(dolospy PRIVATE doloslib)
