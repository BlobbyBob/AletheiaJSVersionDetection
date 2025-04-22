#include "interface.h"

#include <sstream>
#include <iostream>

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include "../index.h"
#include "../tokenizer.h"

namespace py = pybind11;

PYBIND11_MODULE(dolospy, m) {
    m.doc() = "Fast implementation of Dolos core";

    m.attr("magic") = magic;
    m.def("compareFiles", &compareFiles, "Run Dolos on two files", py::arg("f1"), py::arg("f2"));
    m.def("tokenize", [](const std::string &code) {
        return dolos::tokenize(std::span(code.data(), code.size()));
    }, "Tokenize source code", py::arg("code"));

    py::class_<dolos::Index>(m, "Index")
            .def(py::init<uint16_t, uint16_t>())
            .def_static("deserialize", [](const std::string &serialization) {
                return std::make_unique<dolos::Index>(serialization);
            })
            .def("addToGroup", [](dolos::Index &self, const std::string &name, const std::string &code) {
                self.addToGroup(name, std::span(code.data(), code.size()));
            })
            .def("matchExternal", [](const dolos::Index &self, const std::string &code) {
                return self.matchExternal(std::span(code.data(), code.size()));
            })
            .def("matchTokens", [](const dolos::Index &self, const dolos::TokenizedFile &tokens) {
                return self.matchTokens(tokens);
            })
            .def("getPair", &dolos::Index::getPair)
            .def("serialize", &dolos::Index::serialize)
            .def_readonly("identifiers", &dolos::Index::identifiers)
            .def_readonly("names", &dolos::Index::names)
            .def_readonly("index", &dolos::Index::index)
            .def_readonly("group", &dolos::Index::groups);

    py::class_<dolos::Pair>(m, "Pair")
            .def_readonly("left", &dolos::Pair::left)
            .def_readonly("right", &dolos::Pair::right)
            .def_readonly("covered", &dolos::Pair::covered)
            .def_readonly("leftTotal", &dolos::Pair::leftTotal)
            .def_readonly("rightTotal", &dolos::Pair::rightTotal)
            .def("__repr__", [](const dolos::Pair &self) {
                std::ostringstream os;
                os << "<dolospy.Pair left=" << self.left << " right=" << self.right << " covered=" << self.
                        covered << " leftTotal=" << self.leftTotal << " rightTotal=" << self.rightTotal << ">";
                return os.str();
            });
}
